use crate::{
    error::{ApiError, Result},
    files::Files,
    preview::FrameQuery,
    source::file_identity,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::mem::size_of;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs::File,
    ops::ControlFlow,
    os::fd::AsRawFd,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};
use vv_core::{self as core, Id};
use vv_session::{Session, silence as native};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Params {
    pub threshold: f32,
    pub min_silence_secs: f64,
    pub head_secs: f64,
    pub tail_secs: f64,
}
impl Params {
    fn native(&self) -> Result<native::SilenceParams> {
        if !self.threshold.is_finite()
            || !(0.01..=0.99).contains(&self.threshold)
            || !self.min_silence_secs.is_finite()
            || !(0.0..=3.0).contains(&self.min_silence_secs)
            || [self.head_secs, self.tail_secs]
                .into_iter()
                .any(|v| !v.is_finite() || !(0.0..=1.0).contains(&v))
        {
            return Err(ApiError::invalid(
                "Speech threshold or silence padding is outside the native dialog range",
            ));
        }
        Ok(native::SilenceParams {
            threshold: self.threshold,
            min_silence_secs: self.min_silence_secs,
            head_secs: self.head_secs,
            tail_secs: self.tail_secs,
        })
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub query: FrameQuery,
    pub clip_ids: Vec<String>,
    pub params: Params,
}
struct Stream {
    file: File,
    index: usize,
    identity: String,
    seconds: f64,
}
pub struct Task {
    request: Request,
    streams: Vec<Stream>,
    clips: Vec<(core::Clip, usize)>,
    fps: f64,
}
#[derive(Default)]
struct SpeechCache {
    entries: VecDeque<((String, usize), Arc<native::SpeechAnalysis>)>,
    bytes: usize,
}
impl SpeechCache {
    fn get(&mut self, key: &(String, usize)) -> Option<Arc<native::SpeechAnalysis>> {
        let index = self.entries.iter().position(|(stored, _)| stored == key)?;
        let entry = self.entries.remove(index)?;
        let result = entry.1.clone();
        self.entries.push_back(entry);
        Some(result)
    }
    fn insert(&mut self, key: (String, usize), analysis: Arc<native::SpeechAnalysis>) {
        let size = (analysis.probabilities.len() + analysis.levels_db.len()) * size_of::<f32>();
        if size > 32 * 1024 * 1024 {
            return;
        }
        while self.entries.len() >= 64 || self.bytes + size > 32 * 1024 * 1024 {
            let Some((_, old)) = self.entries.pop_front() else {
                break;
            };
            self.bytes -= (old.probabilities.len() + old.levels_db.len()) * size_of::<f32>();
        }
        self.bytes += size;
        self.entries.push_back((key, analysis));
    }
}
impl Task {
    fn key(&self) -> String {
        let q = &self.request.query;
        format!(
            "{}:{}:{}:{}:{}",
            q.project_epoch,
            q.if_generation,
            q.timeline_id,
            q.revision,
            serde_json::to_string(&(
                &self.request.clip_ids,
                &self.request.params,
                self.streams
                    .iter()
                    .map(|s| (&s.identity, s.index))
                    .collect::<Vec<_>>()
            ))
            .unwrap()
        )
    }
    fn run(
        &self,
        cancel: &AtomicBool,
        mut progress: impl FnMut(f64, f64),
        cache: &mut SpeechCache,
    ) -> Result<Value> {
        let started = Instant::now();
        let total = self.streams.iter().map(|s| s.seconds).sum::<f64>();
        let mut done = 0.0;
        let mut results = Vec::new();
        for stream in &self.streams {
            if cancel.load(Ordering::Relaxed) {
                return Err(ApiError::invalid("Speech analysis canceled"));
            }
            if file_identity(&stream.file)? != stream.identity {
                return Err(ApiError::conflict(
                    "SOURCE_CHANGED",
                    "Audio source changed before speech analysis",
                ));
            }
            let path =
                std::path::PathBuf::from(format!("/proc/self/fd/{}", stream.file.as_raw_fd()));
            let key = (stream.identity.clone(), stream.index);
            let analysis = if let Some(analysis) = cache.get(&key) {
                analysis
            } else {
                let analysis = Arc::new(
                    native::media_speech(&path, stream.index, |seconds| {
                        progress((done + seconds).min(total), total);
                        if cancel.load(Ordering::Relaxed)
                            || started.elapsed() > Duration::from_secs(600)
                        {
                            ControlFlow::Break(())
                        } else {
                            ControlFlow::Continue(())
                        }
                    })
                    .map_err(|_| {
                        ApiError::invalid("Native speech analysis failed, was canceled or exceeded its ten-minute execution budget")
                    })?,
                );
                cache.insert(key, analysis.clone());
                analysis
            };
            if file_identity(&stream.file)? != stream.identity {
                return Err(ApiError::conflict(
                    "SOURCE_CHANGED",
                    "Audio source changed during speech analysis",
                ));
            }
            results.push(analysis);
            done += stream.seconds;
            progress(done, total);
        }
        let params = self.request.params.native()?;
        let clips: Vec<_> = self
            .clips
            .iter()
            .map(|(clip, index)| {
                let spans = native::non_speech_spans(&results[*index], params.threshold);
                (
                    (clip.timeline_start, clip.timeline_end()),
                    native::clip_ranges(clip, self.fps, &spans),
                )
            })
            .collect();
        let ranges = native::timeline_cuts(&clips, self.fps, &params);
        if ranges.len() > 4096 {
            return Err(ApiError::invalid(
                "More than 4096 pauses were found; increase minimum silence or analyze fewer clips",
            ));
        }
        Ok(
            json!({"ranges":ranges,"removed_frames":ranges.iter().map(|(start,end)|end-start).sum::<i64>(),"operation":{"kind":"remove_silences","ranges":ranges},"audio_clips":self.clips.len()}),
        )
    }
}

pub fn snapshot(
    session: &Session,
    files: &Files,
    id: core::TimelineId,
    mut request: Request,
) -> Result<Task> {
    request.params.native()?;
    if request.clip_ids.is_empty() || request.clip_ids.len() > 64 {
        return Err(ApiError::invalid(
            "Select between 1 and 64 clips for speech analysis",
        ));
    }
    let timeline = &session.project.timelines[id];
    let mut selected = HashSet::new();
    let mut groups = HashSet::new();
    for raw in &request.clip_ids {
        let clip = core::ClipId(raw.parse().map_err(|_| ApiError::missing())?);
        if !selected.insert(clip) {
            return Err(ApiError::invalid(
                "Speech analysis clip IDs must be distinct",
            ));
        }
        let found = timeline
            .tracks
            .iter()
            .find_map(|track| track.clip(clip))
            .ok_or_else(ApiError::missing)?;
        groups.extend(found.linked_group);
    }
    request.clip_ids.sort();
    let mut streams = Vec::<Stream>::new();
    let mut clips = Vec::new();
    let mut known = HashMap::new();
    let mut total = 0.0;
    for track in timeline
        .tracks
        .iter()
        .filter(|track| track.kind == core::TrackKind::Audio)
    {
        for clip in &track.clips {
            if !selected.contains(&clip.id)
                && !clip
                    .linked_group
                    .is_some_and(|group| groups.contains(&group))
            {
                continue;
            }
            let core::ClipSource::Media(media_id) = clip.source else {
                return Err(ApiError::invalid(
                    "Speech analysis requires source audio media",
                ));
            };
            let media = session
                .project
                .media_pool
                .get(media_id)
                .ok_or_else(ApiError::missing)?;
            if media.compound.is_some() {
                return Err(ApiError::invalid(
                    "Open the compound's child timeline to analyze speech",
                ));
            }
            if !media.meta.has_audio || clip.audio_stream_index >= media.meta.audio_stream_count() {
                return Err(ApiError::invalid(
                    "An analyzed clip has no readable audio stream",
                ));
            }
            let key = (media_id.raw(), clip.audio_stream_index);
            let index = if let Some(index) = known.get(&key) {
                *index
            } else {
                let seconds = media.meta.duration_frames as f64 / media.meta.fps.as_f64();
                if !seconds.is_finite() || seconds <= 0.0 || total + seconds > 86400.0 {
                    return Err(ApiError::invalid(
                        "Speech analysis supports at most 24 hours of distinct source audio per job",
                    ));
                }
                let file = files.media_file(&media.path)?;
                let identity = file_identity(&file)?;
                let index = streams.len();
                streams.push(Stream {
                    file,
                    index: clip.audio_stream_index,
                    identity,
                    seconds,
                });
                known.insert(key, index);
                total += seconds;
                index
            };
            clips.push((clip.clone(), index));
        }
    }
    if clips.is_empty() {
        return Err(ApiError::invalid(
            "Select source audio clips or their linked video clips",
        ));
    }
    Ok(Task {
        request,
        streams,
        clips,
        fps: timeline.fps.as_f64(),
    })
}

pub fn remove_ranges(
    session: &mut Session,
    id: core::TimelineId,
    ranges: &[[i64; 2]],
) -> Result<()> {
    let timeline = &session.project.timelines[id];
    if ranges.is_empty()
        || ranges.len() > 4096
        || ranges
            .iter()
            .any(|[start, end]| *start < 0 || end <= start || *end > timeline.total_frames())
    {
        return Err(ApiError::invalid(
            "Choose between 1 and 4096 nonempty timeline ranges",
        ));
    }
    let first = ranges.iter().map(|[start, _]| *start).min().unwrap();
    if timeline
        .tracks
        .iter()
        .any(|track| track.locked && track.clips.iter().any(|clip| clip.timeline_end() > first))
    {
        return Err(ApiError::conflict(
            "TRACK_LOCKED",
            "Global silence removal would affect a locked track",
        ));
    }
    let native_ranges: Vec<_> = ranges.iter().map(|[start, end]| (*start, *end)).collect();
    let mut trial = Session::default();
    trial.project = session.project.clone();
    core::edit::delete_ranges(
        &mut trial.project,
        &mut trial.history,
        id,
        &native_ranges,
        &core::edit::RangeDelete::Ripple,
    );
    crate::files::validate_project(&trial.project)?;
    let mark = session.history.begin_group();
    core::edit::delete_ranges(
        &mut session.project,
        &mut session.history,
        id,
        &native_ranges,
        &core::edit::RangeDelete::Ripple,
    );
    session
        .history
        .end_group_as(mark, core::CommandLabel::RemoveSilences);
    Ok(())
}

struct Job {
    id: String,
    key: String,
    request: Request,
    state: &'static str,
    progress: (f64, f64),
    result: Option<Value>,
    error: Option<&'static str>,
    cancel: Arc<AtomicBool>,
}
impl Job {
    fn value(&self) -> Value {
        json!({"id":self.id,"state":self.state,"analyzed_seconds":self.progress.0,"total_seconds":self.progress.1,"result":self.result,"error":self.error})
    }
}
#[derive(Clone)]
pub struct Jobs {
    jobs: Arc<Mutex<VecDeque<Job>>>,
    send: mpsc::SyncSender<(String, Task)>,
}
impl Jobs {
    pub fn start() -> Self {
        let jobs = Arc::new(Mutex::new(VecDeque::<Job>::new()));
        let owned = jobs.clone();
        let (send, receive) = mpsc::sync_channel::<(String, Task)>(1);
        std::thread::spawn(move || {
            let mut cache = SpeechCache::default();
            while let Ok((id, task)) = receive.recv() {
                let cancel = {
                    let mut jobs = owned.lock().unwrap();
                    let Some(job) = jobs.iter_mut().find(|job| job.id == id) else {
                        continue;
                    };
                    job.state = "running";
                    job.cancel.clone()
                };
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    task.run(
                        &cancel,
                        |done, total| {
                            if let Some(job) =
                                owned.lock().unwrap().iter_mut().find(|job| job.id == id)
                            {
                                job.progress = (done, total);
                            }
                        },
                        &mut cache,
                    )
                }))
                .unwrap_or_else(|_| Err(ApiError::invalid("Native speech analysis failed")));
                if let Some(job) = owned.lock().unwrap().iter_mut().find(|job| job.id == id) {
                    match result {
                        Ok(value) if !cancel.load(Ordering::Relaxed) => {
                            job.state = "ready";
                            job.result = Some(value);
                        }
                        Err(error) => {
                            job.state = if cancel.load(Ordering::Relaxed) {
                                "canceled"
                            } else {
                                "failed"
                            };
                            job.error = Some(error.2);
                        }
                        _ => job.state = "canceled",
                    }
                }
            }
        });
        Self { jobs, send }
    }
    pub fn prepare(&self, task: Task) -> Result<Value> {
        let key = task.key();
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(job) = jobs.iter().find(|job| {
            job.key == key
                && !job.cancel.load(Ordering::Relaxed)
                && ["queued", "running", "ready"].contains(&job.state)
        }) {
            return Ok(job.value());
        }
        if jobs
            .iter()
            .filter(|job| ["queued", "running"].contains(&job.state))
            .count()
            >= 2
        {
            return Err(ApiError::conflict(
                "ANALYSIS_BUSY",
                "One speech job runs with at most one queued",
            ));
        }
        while jobs.len() >= 8 {
            let index = jobs
                .iter()
                .position(|job| !["queued", "running"].contains(&job.state))
                .ok_or_else(ApiError::io)?;
            jobs.remove(index);
        }
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string();
        jobs.push_back(Job {
            id: id.clone(),
            key,
            request: task.request.clone(),
            state: "queued",
            progress: (0.0, task.streams.iter().map(|s| s.seconds).sum()),
            result: None,
            error: None,
            cancel: Arc::new(AtomicBool::new(false)),
        });
        if self.send.try_send((id.clone(), task)).is_err() {
            jobs.retain(|job| job.id != id);
            return Err(ApiError::conflict(
                "ANALYSIS_BUSY",
                "Speech analysis queue is full",
            ));
        }
        Ok(jobs.back().unwrap().value())
    }
    pub fn request(&self, id: &str, query: &FrameQuery) -> Result<Request> {
        let jobs = self.jobs.lock().unwrap();
        let job = jobs
            .iter()
            .find(|job| job.id == id)
            .ok_or_else(ApiError::missing)?;
        let original = &job.request.query;
        if query.project_epoch != original.project_epoch
            || query.if_generation != original.if_generation
            || query.timeline_id != original.timeline_id
            || query.revision != original.revision
        {
            return Err(ApiError::conflict(
                "REVISION_CONFLICT",
                "Speech analysis belongs to another document revision",
            ));
        }
        Ok(job.request.clone())
    }
    pub fn status(&self, id: &str, task: &Task) -> Result<Value> {
        let jobs = self.jobs.lock().unwrap();
        let job = jobs
            .iter()
            .find(|job| job.id == id)
            .ok_or_else(ApiError::missing)?;
        if job.key != task.key() {
            return Err(ApiError::conflict(
                "SOURCE_CHANGED",
                "Speech analysis inputs changed",
            ));
        }
        Ok(job.value())
    }
    pub fn cancel(&self, id: &str, query: &FrameQuery) -> Result<Value> {
        self.request(id, query)?;
        let jobs = self.jobs.lock().unwrap();
        let job = jobs
            .iter()
            .find(|job| job.id == id)
            .ok_or_else(ApiError::missing)?;
        job.cancel.store(true, Ordering::Relaxed);
        Ok(job.value())
    }
}

#[cfg(test)]
#[path = "tests/silence.rs"]
mod tests;
