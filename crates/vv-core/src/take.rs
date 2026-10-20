//! A take replacement changes explicit clips, never the media item shared by
//! other edits. Duration and linked-clip policies are chosen by the caller.

use crate::{
    Clip, ClipId, ClipSource, Command, CommandLabel, CompositeCommand, EffectStack, FrameIdx,
    MediaId, Project, Rational, SetClipValue, SetCrossTransition, TimelineId, TrackKind,
    convert_frames,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DurationPolicy {
    Preserve,
    Shorten,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LinkPolicy {
    ReplaceLinked,
    SelectedOnly,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AttributePolicy {
    Preserve,
    Reset,
}

pub struct Request {
    pub timeline: TimelineId,
    pub clip: ClipId,
    pub media: MediaId,
    pub source_in: FrameIdx,
    pub duration: DurationPolicy,
    pub links: LinkPolicy,
    pub attributes: AttributePolicy,
}
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum Error {
    #[error("Choose an existing timeline, source clip and imported take")]
    Missing,
    #[error("A selected or linked track is locked")]
    Locked,
    #[error("The take does not contain the required video or audio stream")]
    Stream,
    #[error("Choose an ordinary source media clip; compound replacement is unsupported")]
    Compound,
    #[error("Unfreeze the selected or linked clip before replacing its take")]
    Frozen,
    #[error("Linked clips use different media or speeds; explicitly keep the other linked clips")]
    LinkedSource,
    #[error("The chosen source start does not cover every linked clip")]
    SourceStart,
    #[error("The take is too short to preserve the edit; explicitly shorten or cancel")]
    TooShort,
    #[error("The replacement leaves no available source frames")]
    Empty,
    #[error("The clip, timeline or take has invalid source timing")]
    Timing,
}
#[derive(Debug, Serialize)]
pub struct Change {
    pub track: usize,
    pub clip: ClipId,
    pub previous_media: MediaId,
    pub media: MediaId,
    pub start_frame: FrameIdx,
    pub previous_length: FrameIdx,
    pub length: FrameIdx,
    pub source_in: FrameIdx,
    pub source_out: FrameIdx,
}
#[derive(Debug)]
pub struct Plan {
    pub changes: Vec<Change>,
    pub removed_crossings: usize,
    command: CompositeCommand,
}
impl Plan {
    pub fn into_command(self) -> CompositeCommand {
        self.command
    }
}

pub fn plan(project: &Project, request: &Request) -> Result<Plan, Error> {
    let timeline = project
        .timelines
        .get(request.timeline)
        .ok_or(Error::Missing)?;
    let selected = timeline
        .tracks
        .iter()
        .flat_map(|track| &track.clips)
        .find(|clip| clip.id == request.clip)
        .ok_or(Error::Missing)?;
    let ClipSource::Media(previous_media) = selected.source else {
        return Err(Error::Missing);
    };
    let previous = project
        .media_pool
        .get(previous_media)
        .ok_or(Error::Missing)?;
    let media = project
        .media_pool
        .get(request.media)
        .ok_or(Error::Missing)?;
    if previous.compound.is_some() || media.compound.is_some() {
        return Err(Error::Compound);
    }
    if [
        timeline.fps,
        previous.meta.fps,
        media.meta.fps,
        selected.speed(),
    ]
    .iter()
    .any(|rate| rate.num <= 0 || rate.den <= 0)
        || media.meta.duration_frames <= 0
    {
        return Err(Error::Timing);
    }
    if request.source_in < 0 || request.source_in >= media.meta.duration_frames {
        return Err(Error::SourceStart);
    }
    let conform = Rational::conform_rate(timeline.fps, media.meta.fps);
    let mut replacements = Vec::new();
    for (index, track) in timeline.tracks.iter().enumerate() {
        for clip in &track.clips {
            let linked = request.links == LinkPolicy::ReplaceLinked
                && selected.linked_group.is_some()
                && clip.linked_group == selected.linked_group;
            if clip.id != request.clip && !linked {
                continue;
            }
            if track.locked {
                return Err(Error::Locked);
            }
            if clip.freeze.is_some() {
                return Err(Error::Frozen);
            }
            if !matches!(clip.source, ClipSource::Media(id) if id == previous_media)
                || clip.speed() != selected.speed()
            {
                return Err(Error::LinkedSource);
            }
            if match track.kind {
                TrackKind::Video => !media.meta.has_video,
                TrackKind::Audio => !media.meta.has_audio,
            } {
                return Err(Error::Stream);
            }
            let mut replacement = clip.clone();
            replacement.source = ClipSource::Media(request.media);
            replacement.conform(conform);
            let anchor = replacement.rate().scale_round(request.source_in);
            replacement.source_offset = anchor
                .checked_add(clip.source_offset - selected.source_offset)
                .ok_or(Error::SourceStart)?;
            if replacement.source_offset < 0 {
                return Err(Error::SourceStart);
            }
            let available = replacement.rate().scale_round(media.meta.duration_frames)
                - replacement.source_offset;
            if available <= 0 {
                return Err(Error::Empty);
            }
            if available < clip.timeline_len && request.duration == DurationPolicy::Preserve {
                return Err(Error::TooShort);
            }
            replacement.timeline_len = available.min(clip.timeline_len);
            if request.attributes == AttributePolicy::Preserve {
                // Animation stays on the same edit time when source FPS/In changes.
                replacement
                    .effects
                    .rescale_keyframe_times(previous.meta.fps, media.meta.fps);
                let old_in = convert_frames(clip.source_in(), previous.meta.fps, media.meta.fps);
                replacement
                    .effects
                    .shift_keyframes(replacement.source_in() - old_in);
                if previous.meta.width > 0
                    && previous.meta.height > 0
                    && media.meta.width > 0
                    && media.meta.height > 0
                {
                    replacement.effects.rescale_crop(
                        media.meta.width as f32 / previous.meta.width as f32,
                        media.meta.height as f32 / previous.meta.height as f32,
                    );
                }
            } else {
                replacement.effects = EffectStack::default();
                replacement.fade_in = 0;
                replacement.fade_out = 0;
            }
            replacement.fade_in = replacement.fade_in.min(replacement.timeline_len);
            replacement.fade_out = replacement.fade_out.min(replacement.timeline_len);
            for transition in [
                &mut replacement.effects.transition_in,
                &mut replacement.effects.transition_out,
            ]
            .into_iter()
            .flatten()
            {
                transition.duration = transition.duration.min(replacement.timeline_len);
            }
            replacements.push((index, replacement));
        }
    }
    let changes = replacements
        .iter()
        .map(|(track, clip)| Change {
            track: *track,
            clip: clip.id,
            previous_media,
            media: request.media,
            start_frame: clip.timeline_start,
            previous_length: timeline.tracks[*track].clip(clip.id).unwrap().timeline_len,
            length: clip.timeline_len,
            source_in: clip.source_in(),
            source_out: clip.source_out(),
        })
        .collect();
    let mut commands: Vec<Box<dyn Command>> = Vec::new();
    let mut removed_crossings = 0;
    for (index, track) in timeline.tracks.iter().enumerate() {
        for crossing in &track.crossings {
            if replacements.iter().any(|(t, clip)| {
                *t == index
                    && (clip.id == crossing.left_clip || clip.id == crossing.right_clip)
                    && clip.timeline_len != track.clip(clip.id).unwrap().timeline_len
            }) {
                commands.push(Box::new(SetCrossTransition::new(
                    request.timeline,
                    index,
                    crossing.left_clip,
                    None,
                )));
                removed_crossings += 1;
            }
        }
    }
    for (track, clip) in replacements {
        commands.push(Box::new(SetClipValue::new(
            request.timeline,
            track,
            clip.id,
            CommandLabel::ReplaceTake,
            clip,
            |clip: &mut Clip| clip,
        )));
    }
    Ok(Plan {
        changes,
        removed_crossings,
        command: CompositeCommand::new(CommandLabel::ReplaceTake, commands),
    })
}

#[cfg(test)]
#[path = "tests/take.rs"]
mod tests;
