use std::{fs::OpenOptions, io::Write, path::PathBuf};
use vv_core::{
    Clip, ClipSource, Id, Interpolation, Keyframed, Rational, Rgba, Timeline, Track, TrackKind,
    TransformParam,
};
use vv_session::Session;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str){
        Some("fixture") if args.len()==4=>{
            let source=PathBuf::from(&args[2]).canonicalize()?;
            let meta=vv_media::probe_media(&source)?;let frames=meta.duration_frames.min(48);
            let mut session=Session::default();
            let id=session.create_timeline(Timeline{name:"GPU composition verification".into(),fps:meta.fps,resolution:(1920,1080),tracks:vec![Track::new(TrackKind::Video),Track::new(TrackKind::Video),Track::new(TrackKind::Audio)],markers:vec![],master:Default::default()});
            let media=session.add_media(source,meta);
            let source=Clip::from_source_range(session.project.alloc_clip_id(),ClipSource::Media(media),0,frames,0,Rational::one());
            let mut overlay=Clip::from_source_range(session.project.alloc_clip_id(),ClipSource::SolidColor,0,frames,0,Rational::one());
            overlay.effects.color=Some(Keyframed::constant(Rgba{r:1.0,g:0.2,b:0.05,a:1.0}));
            overlay.effects.transform.track_mut(TransformParam::Opacity).default=60.0;
            overlay.effects.transform.track_mut(TransformParam::ZoomX).default=0.35;
            overlay.effects.transform.track_mut(TransformParam::ZoomY).default=0.4;
            let position=overlay.effects.transform.track_mut(TransformParam::PositionX);
            position.upsert(0,-60.0,Interpolation::Linear);position.upsert(36,60.0,Interpolation::Linear);
            session.project.timelines[id].tracks[0].insert_sorted(source);
            session.project.timelines[id].tracks[1].insert_sorted(overlay);
            session.sync_timeline_media(id);
            let text=ron::ser::to_string_pretty(&session.project,ron::ser::PrettyConfig::default())?;
            OpenOptions::new().create_new(true).write(true).open(&args[3])?.write_all(text.as_bytes())?;
            println!("fixture_timeline={} frames={frames}",id.raw());
        }
        Some("render") if args.len()==6=>{
            let project=vv_core::load_project(std::path::Path::new(&args[2]))?;
            let frame=args[3].parse()?;let width:u32=args[4].parse()?;
            let id=project.timelines.keys().next().ok_or("No timeline")?;let tl=&project.timelines[id];
            let height=(u64::from(tl.resolution.1)*u64::from(width)/u64::from(tl.resolution.0)).max(1) as u32;
            let lock=OpenOptions::new().create(true).truncate(false).read(true).write(true).open("/tmp/HALO_BENCHMARK.lock")?;
            rustix::fs::flock(&lock,rustix::fs::FlockOperation::NonBlockingLockExclusive)?;
            let compositor=vv_render::Compositor::new_headless_with_precision(project.precision);
            if !compositor.adapter_name().contains("R9700")||!compositor.adapter_name().contains("Vulkan"){return Err("Reference renderer did not select R9700 Vulkan".into());}
            let rgba=vv_session::export::render_frame_rgba(&project,id,frame,(width,height),&compositor).map_err(|error|std::io::Error::other(error.to_string()))?;
            OpenOptions::new().create_new(true).write(true).open(&args[5])?.write_all(&rgba)?;
            println!("native_adapter={} frame={frame} size={width}x{height} bytes={}",compositor.adapter_name(),rgba.len());
        }
        _=>return Err("Usage: verify_preview fixture SOURCE OUTPUT.vvproj | render PROJECT FRAME WIDTH OUTPUT.rgba".into()),
    }
    Ok(())
}
