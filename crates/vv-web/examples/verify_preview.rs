use std::{fs::OpenOptions, io::Write, path::PathBuf};
use vv_core::{
    Clip, ClipSource, Id, Interpolation, Keyframed, Rational, Rgba, Timeline, Track, TrackKind,
    TransformParam,
};
use vv_session::Session;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str){
        Some("fixture_parity") if args.len()==3=>fixture_parity(std::path::Path::new(&args[2]))?,
        Some("export") if args.len()==4=>{
            let project=vv_core::load_project(std::path::Path::new(&args[2]))?;
            let id=project.timelines.keys().next().ok_or("No timeline")?;
            let output=PathBuf::from(&args[3]);if output.exists(){return Err("Output already exists".into());}
            let lock=OpenOptions::new().create(true).truncate(false).read(true).write(true).open("/tmp/HALO_BENCHMARK.lock")?;
            rustix::fs::flock(&lock,rustix::fs::FlockOperation::NonBlockingLockExclusive)?;
            let mut settings=vv_session::export::ExportSettings::new(output);settings.video.preset="veryfast".into();settings.video.quality=18;
            let progress=std::sync::Mutex::new(vv_session::export::ExportProgress::default());
            vv_session::export::export_timeline_with_gpu(&project,id,&settings,0..project.timelines[id].total_frames(),&progress,&std::sync::atomic::AtomicBool::new(false),
                ||Ok(vv_render::Compositor::new_headless_with_precision(project.precision)), |_|Ok(()),2)
                .map_err(|error|std::io::Error::other(error.to_string()))?;
            let p=progress.lock().unwrap();
            println!("{}",serde_json::json!({"frames":p.current_frame,"elapsed_seconds":p.elapsed.as_secs_f64(),"compositor":p.compositor,"encoder":format!("{:?}",p.encoder),"decode_fps":p.decode.fps(),"compose_fps":p.compose.fps(),"encode_fps":p.encode.fps()}));
        }
        Some("fixture_sync") if args.len()==4=>{
            let source=PathBuf::from(&args[2]).canonicalize()?;
            let meta=vv_media::probe_media(&source)?;
            let mut session=Session::default();
            let id=session.create_timeline(Timeline{name:"Five-minute AV sync verification".into(),fps:Rational::new(24,1),resolution:(640,360),tracks:vec![Track::new(TrackKind::Video),Track::new(TrackKind::Video),Track::new(TrackKind::Audio)],markers:vec![],master:Default::default()});
            let media=session.add_media(source,meta.clone());
            vv_core::edit::insert_media(&mut session.project,&mut session.history,id,
                vv_core::edit::MediaInsert{media_id:media,source_in:0,source_out:meta.duration_frames,video:false,audio:true},0,
                vv_core::edit::TargetTracks{video:None,extra_audio:Some(2)});
            let mut background=Clip::from_source_range(session.project.alloc_clip_id(),ClipSource::SolidColor,0,7200,0,Rational::one());
            background.effects.color=Some(Keyframed::constant(Rgba{r:0.0,g:0.0,b:0.0,a:1.0}));
            session.project.timelines[id].tracks[0].insert_sorted(background);
            for start in [0,1440,2880,4320,5760]{
                let mut flash=Clip::from_source_range(session.project.alloc_clip_id(),ClipSource::SolidColor,0,3,start,Rational::one());
                flash.effects.color=Some(Keyframed::constant(Rgba{r:1.0,g:1.0,b:1.0,a:1.0}));
                session.project.timelines[id].tracks[1].insert_sorted(flash);
            }
            session.sync_timeline_media(id);
            let text=ron::ser::to_string_pretty(&session.project,ron::ser::PrettyConfig::default())?;
            OpenOptions::new().create_new(true).write(true).open(&args[3])?.write_all(text.as_bytes())?;
            println!("fixture_timeline={} frames=7200",id.raw());
        }
        Some("fixture" | "fixture_av") if args.len()==4=>{
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
            if args[1] == "fixture_av" {
                vv_core::edit::insert_media(&mut session.project, &mut session.history, id,
                    vv_core::edit::MediaInsert { media_id: media, source_in: 0, source_out: frames, video: true, audio: true },
                    0, vv_core::edit::TargetTracks { video: Some(0), extra_audio: Some(2) });
            } else { session.project.timelines[id].tracks[0].insert_sorted(source); }
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
        _=>return Err("Usage: verify_preview fixture_parity NEW_OUTPUT_DIR | fixture|fixture_av|fixture_sync SOURCE OUTPUT.vvproj | render PROJECT FRAME WIDTH OUTPUT.rgba | export PROJECT OUTPUT.mp4".into()),
    }
    Ok(())
}

fn parity_solid(id: u64, color: Rgba, start: i64, len: i64) -> Clip {
    let mut clip = Clip::from_source_range(
        vv_core::ClipId(id),
        ClipSource::SolidColor,
        0,
        len,
        start,
        Rational::one(),
    );
    clip.effects.color = Some(Keyframed::constant(color));
    clip
}

fn parity_timeline(name: &str, layers: Vec<Vec<Clip>>) -> Timeline {
    Timeline {
        name: name.into(),
        fps: Rational::new(24, 1),
        resolution: (64, 64),
        tracks: layers
            .into_iter()
            .map(|clips| {
                let mut track = Track::new(TrackKind::Video);
                for clip in clips {
                    track.insert_sorted(clip);
                }
                track
            })
            .collect(),
        markers: Vec::new(),
        master: Default::default(),
    }
}

fn parity_write_new(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

fn parity_case(
    directory: &std::path::Path,
    cases: &mut Vec<serde_json::Value>,
    name: &str,
    family: &str,
    native_value: serde_json::Value,
    timeline: Timeline,
    frames: &[i64],
    comparisons: Vec<serde_json::Value>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut session = Session::default();
    let last_id = timeline
        .tracks
        .iter()
        .flat_map(|track| &track.clips)
        .map(|clip| clip.id.0)
        .max()
        .unwrap_or(0);
    for _ in 0..=last_id {
        session.project.alloc_clip_id();
    }
    session.create_timeline(timeline);
    let project = format!("{name}.vvproj");
    let text = ron::ser::to_string_pretty(&session.project, ron::ser::PrettyConfig::default())?;
    parity_write_new(&directory.join(&project), text.as_bytes())?;
    cases.push(serde_json::json!({
        "name":name,"project":project,"family":family,"native_value":native_value,
        "frames":frames,"comparisons":comparisons
    }));
    Ok(())
}

fn parity_comparison(
    frame: i64,
    control: &str,
    control_frame: i64,
    relation: &str,
) -> serde_json::Value {
    serde_json::json!({"frame":frame,"control_project":format!("{control}.vvproj"),"control_frame":control_frame,"relation":relation})
}

fn fixture_parity(directory: &std::path::Path) -> Result<(), Box<dyn std::error::Error>> {
    use serde_json::json;
    use vv_core::{
        BlendMode, ClipMask, MaskMode, MaskParam, MaskPath, MaskShape, MatteMode, PathPoint,
    };

    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(directory)?;
    let mut cases = Vec::new();
    let red = Rgba {
        r: 1.0,
        g: 0.0,
        b: 0.0,
        a: 1.0,
    };
    let blue = Rgba {
        r: 0.0,
        g: 0.0,
        b: 1.0,
        a: 1.0,
    };
    let base = Rgba {
        r: 0.18,
        g: 0.42,
        b: 0.72,
        a: 1.0,
    };
    let top = Rgba {
        r: 0.68,
        g: 0.27,
        b: 0.49,
        a: 1.0,
    };
    let background = || parity_solid(1, base, 0, 24);
    let mask_layers = |masks: Vec<ClipMask>| {
        let mut foreground = parity_solid(2, red, 0, 24);
        foreground.effects.masks = masks;
        vec![vec![parity_solid(1, blue, 0, 24)], vec![foreground]]
    };
    parity_case(
        directory,
        &mut cases,
        "solid_black",
        "control",
        json!("Black"),
        parity_timeline(
            "solid_black",
            vec![vec![parity_solid(1, Rgba::BLACK, 0, 24)]],
        ),
        &[0],
        vec![],
    )?;
    parity_case(
        directory,
        &mut cases,
        "solid_red",
        "solid",
        json!(red),
        parity_timeline("solid_red", vec![vec![parity_solid(1, red, 0, 24)]]),
        &[0],
        vec![parity_comparison(0, "solid_black", 0, "different")],
    )?;
    parity_case(
        directory,
        &mut cases,
        "blend_background",
        "control",
        json!(base),
        parity_timeline("blend_background", vec![vec![background()]]),
        &[0],
        vec![],
    )?;
    for mode in BlendMode::ALL {
        let name = format!("blend_{mode:?}");
        let mut foreground = parity_solid(2, top, 0, 24);
        foreground.effects.blend_mode = mode;
        foreground
            .effects
            .transform
            .track_mut(TransformParam::Opacity)
            .default = 63.0;
        let control = if mode == BlendMode::Normal {
            "blend_background"
        } else {
            "blend_Normal"
        };
        parity_case(
            directory,
            &mut cases,
            &name,
            "blend",
            json!(mode),
            parity_timeline(&name, vec![vec![background()], vec![foreground]]),
            &[0],
            vec![parity_comparison(0, control, 0, "different")],
        )?;
    }
    let matte_layers = || {
        vec![
            vec![parity_solid(1, blue, 0, 24)],
            vec![parity_solid(2, red, 0, 24)],
        ]
    };
    parity_case(
        directory,
        &mut cases,
        "matte_unmasked",
        "control",
        json!(null),
        parity_timeline("matte_unmasked", matte_layers()),
        &[0],
        vec![],
    )?;
    for mode in MatteMode::ALL {
        let name = format!("matte_{mode:?}");
        let mut matte = parity_solid(
            3,
            Rgba {
                r: 0.35,
                g: 0.35,
                b: 0.35,
                a: 1.0,
            },
            0,
            24,
        );
        matte.effects.matte = Some(mode);
        matte
            .effects
            .transform
            .track_mut(TransformParam::CropRight)
            .default = 32.0;
        let mut layers = matte_layers();
        layers.push(vec![matte]);
        parity_case(
            directory,
            &mut cases,
            &name,
            "matte",
            json!(mode),
            parity_timeline(&name, layers),
            &[0],
            vec![parity_comparison(0, "matte_unmasked", 0, "different")],
        )?;
    }
    parity_case(
        directory,
        &mut cases,
        "mask_unmasked",
        "control",
        json!(null),
        parity_timeline("mask_unmasked", mask_layers(vec![])),
        &[0],
        vec![],
    )?;
    for shape in MaskShape::ALL {
        let name = format!("mask_{shape:?}");
        let mut mask = ClipMask::new(shape, (64, 64));
        if shape == MaskShape::Path {
            mask.path = Keyframed::constant(MaskPath {
                points: vec![
                    PathPoint {
                        out_handle: [12.0, 18.0],
                        ..PathPoint::corner([-20.0, -16.0])
                    },
                    PathPoint {
                        in_handle: [-8.0, -12.0],
                        ..PathPoint::corner([20.0, -10.0])
                    },
                    PathPoint {
                        in_handle: [12.0, 0.0],
                        out_handle: [-12.0, 0.0],
                        ..PathPoint::corner([0.0, 22.0])
                    },
                ],
            });
        } else {
            mask.track_mut(MaskParam::Width).default = 44.0;
            mask.track_mut(MaskParam::Height).default = 40.0;
        }
        let frames: &[i64] = if shape == MaskShape::Rectangle {
            mask.track_mut(MaskParam::CenterX)
                .upsert(0, 0.0, Interpolation::Linear);
            mask.track_mut(MaskParam::CenterX)
                .upsert(12, 9.0, Interpolation::Linear);
            &[0, 12]
        } else {
            &[0]
        };
        let mut comparisons: Vec<_> = frames
            .iter()
            .map(|&frame| parity_comparison(frame, "mask_unmasked", 0, "different"))
            .collect();
        if shape == MaskShape::Rectangle {
            comparisons.push(parity_comparison(12, &name, 0, "different"));
        }
        parity_case(
            directory,
            &mut cases,
            &name,
            "mask",
            json!(shape),
            parity_timeline(&name, mask_layers(vec![mask])),
            frames,
            comparisons,
        )?;
    }
    for mode in [MaskMode::Subtract, MaskMode::Intersect] {
        let name = format!("mask_{mode:?}");
        let mut rectangle = ClipMask::new(MaskShape::Rectangle, (64, 64));
        rectangle.track_mut(MaskParam::Width).default = 44.0;
        rectangle.track_mut(MaskParam::Height).default = 40.0;
        let mut ellipse = ClipMask::new(MaskShape::Ellipse, (64, 64));
        ellipse.mode = mode;
        ellipse.track_mut(MaskParam::Width).default = 24.0;
        ellipse.track_mut(MaskParam::Height).default = 28.0;
        ellipse.track_mut(MaskParam::CenterX).default = 12.0;
        parity_case(
            directory,
            &mut cases,
            &name,
            "mask_boolean",
            json!(mode),
            parity_timeline(&name, mask_layers(vec![rectangle, ellipse])),
            &[0],
            vec![parity_comparison(0, "mask_Rectangle", 0, "different")],
        )?;
    }
    let mut feather = ClipMask::new(MaskShape::Rectangle, (64, 64));
    feather.track_mut(MaskParam::Width).default = 44.0;
    feather.track_mut(MaskParam::Height).default = 40.0;
    feather.track_mut(MaskParam::Feather).default = 6.0;
    parity_case(
        directory,
        &mut cases,
        "mask_feather",
        "mask_feather",
        json!(6.0),
        parity_timeline("mask_feather", mask_layers(vec![feather])),
        &[0],
        vec![parity_comparison(0, "mask_Rectangle", 0, "different")],
    )?;
    let mut title = parity_solid(2, Rgba::WHITE, 0, 24);
    title.source = ClipSource::Text;
    title.effects.color = None;
    title.effects.title = Some(vv_core::TitleParams {
        content: Keyframed::constant("Aa".into()),
        size: 24.0,
        ..Default::default()
    });
    parity_case(
        directory,
        &mut cases,
        "title_default_font",
        "title",
        json!("System sans-serif; Aa; 24px"),
        parity_timeline(
            "title_default_font",
            vec![vec![parity_solid(1, Rgba::BLACK, 0, 24)], vec![title]],
        ),
        &[0],
        vec![parity_comparison(0, "solid_black", 0, "different")],
    )?;
    let transition_layers = || {
        vec![vec![
            parity_solid(1, red, 0, 12),
            parity_solid(2, blue, 12, 12),
        ]]
    };
    parity_case(
        directory,
        &mut cases,
        "transition_cut",
        "control",
        json!(null),
        parity_timeline("transition_cut", transition_layers()),
        &[7, 12],
        vec![],
    )?;
    for kind in [
        vv_core::TransitionKind::Push,
        vv_core::TransitionKind::CrossDissolve,
        vv_core::TransitionKind::SmoothCut,
    ] {
        let name = format!("transition_{kind:?}");
        let mut timeline = parity_timeline(&name, transition_layers());
        timeline.tracks[0].crossings.push(vv_core::CrossTransition {
            left_clip: vv_core::ClipId(1),
            right_clip: vv_core::ClipId(2),
            transition: vv_core::Transition {
                kind,
                duration: 8,
                direction: vv_core::PushDirection::Right,
                ease: vv_core::Transition::default_ease(kind),
                curve: 0.5,
            },
        });
        parity_case(
            directory,
            &mut cases,
            &name,
            "transition",
            json!(kind),
            timeline,
            &[7, 12, 16],
            vec![
                parity_comparison(7, "transition_cut", 7, "equal"),
                parity_comparison(12, "transition_cut", 12, "different"),
                parity_comparison(16, "transition_cut", 12, "equal"),
            ],
        )?;
    }
    let reference_frames: usize = cases
        .iter()
        .map(|case| case["frames"].as_array().map_or(0, Vec::len))
        .sum();
    let manifest = json!({
        "version":1,"resolution":{"width":64,"height":64},"fps":{"num":24,"den":1},
        "reference_frames":reference_frames,"cases":cases,
        "notes":[
            "Every project contains one native timeline and only generated solids/text; no external media.",
            "Compare decoded HTTP PNG RGBA with the native render mode byte for byte; equal/different controls also require actual rendered bytes.",
            "Title uses the existing system default font: native layout parity only, not foreign font equivalence.",
            "Solid SmoothCut covers the native solid morph/fallback path, not moving-media optical-flow acceptance.",
            "Generation performs no rendering or hardware initialization; GPU qualification is explicit and separately lock guarded."
        ]
    });
    parity_write_new(
        &directory.join("manifest.json"),
        &serde_json::to_vec_pretty(&manifest)?,
    )?;
    println!(
        "{}",
        json!({"manifest":directory.join("manifest.json"),"projects":manifest["cases"].as_array().map_or(0, Vec::len),"reference_frames":reference_frames})
    );
    Ok(())
}
