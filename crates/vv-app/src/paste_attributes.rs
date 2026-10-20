//! "Paste attributes" (Alt+V): copies onto the selected clips only the
//! attributes chosen in the dialog, taken from the clips in the clipboard.

use super::*;
use std::collections::HashSet;
use vv_core::{Clip, ClipAttributes};

use vv_core::attributes::merge;
pub(crate) use vv_core::attributes::{
    Attribute, Conversion, KeyframeAnchor, KeyframeMode, TimelineFormat,
};

/// The dialog's sections, in the order and with the names of the
/// Properties panel.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Section {
    Transform,
    Crop,
    Blending,
    Filters,
    Masks,
    Transitions,
    Audio,
    Clip,
}

impl Section {
    pub(crate) const ALL: [Section; 8] = [
        Section::Transform,
        Section::Crop,
        Section::Blending,
        Section::Filters,
        Section::Masks,
        Section::Transitions,
        Section::Audio,
        Section::Clip,
    ];

    fn title(self) -> std::borrow::Cow<'static, str> {
        match self {
            Section::Transform => t!("props.transform"),
            Section::Crop => t!("props.cropping"),
            Section::Blending => t!("props.composite"),
            Section::Filters => t!("props.filters"),
            Section::Masks => t!("props.masks"),
            Section::Transitions => t!("props.transition"),
            Section::Audio => t!("props.tab_audio"),
            Section::Clip => t!("paste_attr.clip"),
        }
    }

    /// The kind of clip the section applies to; `None` = any.
    pub(crate) fn kind(self) -> Option<TrackKind> {
        match self {
            Section::Clip => None,
            Section::Audio => Some(TrackKind::Audio),
            _ => Some(TrackKind::Video),
        }
    }
}

pub(crate) trait AttributeUi {
    fn section(self) -> Section;
    fn label(self) -> std::borrow::Cow<'static, str>;
}

impl AttributeUi for Attribute {
    fn section(self) -> Section {
        match self {
            Attribute::Zoom
            | Attribute::Position
            | Attribute::Rotation
            | Attribute::AnchorPoint
            | Attribute::Flip => Section::Transform,
            Attribute::Crop | Attribute::CropSoftness => Section::Crop,
            Attribute::BlendMode | Attribute::Matte | Attribute::Opacity => Section::Blending,
            Attribute::Filters => Section::Filters,
            Attribute::Masks => Section::Masks,
            Attribute::Transitions => Section::Transitions,
            Attribute::Volume => Section::Audio,
            Attribute::Fades | Attribute::Speed => Section::Clip,
        }
    }

    fn label(self) -> std::borrow::Cow<'static, str> {
        match self {
            Attribute::Fades => t!("paste_attr.fades"),
            Attribute::Speed => t!("paste_attr.speed"),
            Attribute::BlendMode => t!("props.composite_mode"),
            Attribute::Matte => t!("props.matte"),
            Attribute::Opacity => t!("props.opacity"),
            Attribute::Position => t!("props.position"),
            Attribute::Rotation => t!("props.rotation"),
            Attribute::AnchorPoint => t!("props.anchor_point"),
            Attribute::Zoom => t!("props.zoom"),
            Attribute::Crop => t!("paste_attr.crop_edges"),
            Attribute::CropSoftness => t!("props.softness"),
            Attribute::Flip => t!("props.flip"),
            Attribute::Filters => t!("props.filters"),
            Attribute::Masks => t!("props.masks"),
            Attribute::Transitions => t!("props.transition"),
            Attribute::Volume => t!("props.volume"),
        }
    }
}

pub(crate) struct PasteAttributesDialog {
    /// Name shown as the origin of the attributes.
    source_name: String,
    /// Clips whose attributes are read, one per track kind: a copied
    /// A/V group pastes the video attributes onto the video clips and the
    /// audio ones onto the audio clips.
    source_video: Option<Clip>,
    source_audio: Option<Clip>,
    targets: Vec<(usize, ClipId)>,
    video_targets: usize,
    audio_targets: usize,
    selected: HashSet<Attribute>,
    keyframe_mode: KeyframeMode,
}

impl PasteAttributesDialog {
    fn has_source_for(&self, kind: TrackKind) -> bool {
        match kind {
            TrackKind::Video => self.source_video.is_some(),
            TrackKind::Audio => self.source_audio.is_some(),
        }
    }

    /// A section is shown only if some target can receive it.
    fn section_applies(&self, section: Section) -> bool {
        match section.kind() {
            None => !self.targets.is_empty(),
            Some(TrackKind::Video) => {
                self.video_targets > 0 && self.has_source_for(TrackKind::Video)
            }
            Some(TrackKind::Audio) => {
                self.audio_targets > 0 && self.has_source_for(TrackKind::Audio)
            }
        }
    }
}

impl VenturiApp {
    /// Opens the dialog on the current selection; does nothing if there is
    /// nothing to copy from or onto.
    pub(crate) fn open_paste_attributes_dialog(&mut self) {
        let Some(timeline_id) = self.timeline_id else {
            return;
        };
        if self.timeline_state.clipboard.is_empty() || self.timeline_state.selected.is_empty() {
            return;
        }
        let tl = &self.session.project.timelines[timeline_id];
        let source_of = |kind: TrackKind| {
            self.timeline_state
                .clipboard
                .iter()
                .find(|e| e.track_kind == kind)
                .map(|e| e.clip.clone())
        };
        let source_video = source_of(TrackKind::Video);
        let source_audio = source_of(TrackKind::Audio);
        let source_name = source_video
            .as_ref()
            .or(source_audio.as_ref())
            .map(|clip| self.clip_display_name(clip))
            .unwrap_or_default();

        let targets: Vec<(usize, ClipId)> = self
            .timeline_state
            .selected
            .iter()
            .copied()
            .filter(|&(track_index, clip_id)| {
                !tl.is_locked(track_index) && tl.clip(track_index, clip_id).is_some()
            })
            .collect();
        if targets.is_empty() {
            return;
        }
        let count_of = |kind: TrackKind| {
            targets
                .iter()
                .filter(|&&(track_index, _)| tl.tracks[track_index].kind == kind)
                .count()
        };
        let (video_targets, audio_targets) =
            (count_of(TrackKind::Video), count_of(TrackKind::Audio));

        self.paste_attributes = Some(PasteAttributesDialog {
            source_name,
            source_video,
            source_audio,
            targets,
            video_targets,
            audio_targets,
            selected: self.paste_attributes_selection.clone(),
            keyframe_mode: self.paste_attributes_keyframe_mode,
        });
    }

    pub(crate) fn clip_display_name(&self, clip: &Clip) -> String {
        match &clip.source {
            vv_core::ClipSource::Media(media_id) => self
                .session
                .project
                .media_pool
                .get(*media_id)
                .map(|item| {
                    item.path
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_else(|| item.path.to_string_lossy().into_owned())
                })
                .unwrap_or_default(),
            vv_core::ClipSource::SolidColor => t!("generator.solid_color").into_owned(),
            vv_core::ClipSource::Text => t!("generator.text").into_owned(),
            vv_core::ClipSource::Adjustment => t!("generator.adjustment").into_owned(),
        }
    }

    pub(crate) fn show_paste_attributes_dialog(&mut self, ctx: &egui::Context) {
        let Some(dialog) = &mut self.paste_attributes else {
            return;
        };
        let mut open = true;
        let mut apply = false;
        let mut cancel = false;
        egui::Window::new(t!("paste_attr.title"))
            .id(egui::Id::new("paste_attributes_dialog"))
            .open(&mut open)
            .collapsible(false)
            .resizable(false)
            .default_width(420.0)
            .show(ctx, |ui| {
                ui.label(t!(
                    "paste_attr.context",
                    source = dialog.source_name,
                    count = dialog.targets.len()
                ));

                let applies: Vec<Section> = Section::ALL
                    .into_iter()
                    .filter(|&s| dialog.section_applies(s))
                    .collect();
                attribute_checkboxes(ui, &mut dialog.selected, &applies);

                ui.separator();
                ui.label(egui::RichText::new(t!("paste_attr.keyframes")).strong());
                ui.radio_value(
                    &mut dialog.keyframe_mode,
                    KeyframeMode::MaintainTiming,
                    t!("paste_attr.maintain_timing"),
                );
                ui.radio_value(
                    &mut dialog.keyframe_mode,
                    KeyframeMode::StretchToFit,
                    t!("paste_attr.stretch_to_fit"),
                );

                ui.separator();
                ui.horizontal(|ui| {
                    if ui.button(t!("common.cancel")).clicked() {
                        cancel = true;
                    }
                    if ui
                        .add_enabled(
                            !dialog.selected.is_empty(),
                            egui::Button::new(t!("paste_attr.apply")),
                        )
                        .clicked()
                    {
                        apply = true;
                    }
                });
            });
        if !open {
            cancel = true;
        }
        if !(apply || cancel) {
            return;
        }
        let dialog = self.paste_attributes.take().expect("just checked");
        // The choices stay for the next time, as in the other NLEs.
        self.paste_attributes_selection = dialog.selected.clone();
        self.paste_attributes_keyframe_mode = dialog.keyframe_mode;
        if apply {
            self.apply_paste_attributes(&dialog);
        }
    }

    fn apply_paste_attributes(&mut self, dialog: &PasteAttributesDialog) {
        let source_ids =
            [&dialog.source_video, &dialog.source_audio].map(|c| c.as_ref().map(|c| c.id));
        let targets: Vec<(usize, ClipId)> = dialog
            .targets
            .iter()
            .copied()
            .filter(|(_, id)| !source_ids.contains(&Some(*id)))
            .collect();
        let mode = dialog.keyframe_mode;
        self.apply_attributes(
            &targets,
            dialog.source_video.as_ref(),
            dialog.source_audio.as_ref(),
            &dialog.selected,
            |source, target, _| Conversion::paste(source, target, mode),
            vv_core::CommandLabel::PasteAttributes,
        );
    }

    /// Sets the `selected` attributes of the source of each target's kind
    /// onto the targets, as one undo step.
    pub(crate) fn apply_attributes(
        &mut self,
        targets: &[(usize, ClipId)],
        source_video: Option<&Clip>,
        source_audio: Option<&Clip>,
        selected: &HashSet<Attribute>,
        conversion: impl Fn(&Clip, &Clip, &vv_core::Timeline) -> Conversion,
        label: vv_core::CommandLabel,
    ) {
        let Some(timeline_id) = self.timeline_id else {
            return;
        };
        let mut commands: Vec<(usize, ClipId, ClipAttributes)> = Vec::new();
        let mut speeds: SpeedTargets = Vec::new();
        {
            let tl = &self.session.project.timelines[timeline_id];
            for &(track_index, clip_id) in targets {
                let (Some(track), Some(target)) =
                    (tl.tracks.get(track_index), tl.clip(track_index, clip_id))
                else {
                    continue;
                };
                if tl.is_locked(track_index) {
                    continue;
                }
                let source = match track.kind {
                    TrackKind::Video => source_video,
                    TrackKind::Audio => source_audio,
                };
                let Some(source) = source else {
                    continue;
                };
                commands.push((
                    track_index,
                    clip_id,
                    merge(source, target, selected, &conversion(source, target, tl)),
                ));
                if selected.contains(&Attribute::Speed)
                    && matches!(target.source, vv_core::ClipSource::Media(_))
                    && (target.speed(), target.pitch_correction)
                        != (source.speed(), source.pitch_correction)
                {
                    let key = (source.speed(), source.pitch_correction);
                    match speeds.iter_mut().find(|(k, _)| *k == key) {
                        Some((_, clips)) => clips.push((track_index, clip_id)),
                        None => speeds.push((key, vec![(track_index, clip_id)])),
                    }
                }
            }
        }
        if commands.is_empty() {
            return;
        }
        let mark = self.session.history.begin_group();
        for (track_index, clip_id, attributes) in commands {
            self.session.history.do_command(
                &mut self.session.project,
                Box::new(vv_core::SetClipAttributes::new(
                    timeline_id,
                    track_index,
                    clip_id,
                    attributes,
                )),
            );
        }
        // Ripple: several pasted clips can be adjacent, and each one's new
        // length must not overwrite the next.
        for ((speed, pitch_correction), clips) in speeds {
            self.session.history.do_command(
                &mut self.session.project,
                Box::new(vv_core::SetClipSpeed::new(
                    timeline_id,
                    clips,
                    speed,
                    pitch_correction,
                    vv_core::SpeedFit::Ripple,
                )),
            );
        }
        self.session.history.end_group_as(mark, label);
    }
}

/// One checkbox per section of `sections`, plus one per attribute when the
/// section has more than one.
pub(crate) fn attribute_checkboxes(
    ui: &mut egui::Ui,
    selected: &mut HashSet<Attribute>,
    sections: &[Section],
) {
    for &section in sections {
        let members: Vec<Attribute> = Attribute::ALL
            .into_iter()
            .filter(|a| a.section() == section)
            .collect();
        ui.separator();
        let mut all = members.iter().all(|a| selected.contains(a));
        if ui
            .checkbox(&mut all, egui::RichText::new(section.title()).strong())
            .changed()
        {
            for attribute in &members {
                if all {
                    selected.insert(*attribute);
                } else {
                    selected.remove(attribute);
                }
            }
        }
        if members.len() < 2 {
            continue;
        }
        ui.indent(("attribute_section", section as usize), |ui| {
            ui.horizontal_wrapped(|ui| {
                for attribute in &members {
                    let mut on = selected.contains(attribute);
                    if ui.checkbox(&mut on, attribute.label()).changed() {
                        if on {
                            selected.insert(*attribute);
                        } else {
                            selected.remove(attribute);
                        }
                    }
                }
            });
        });
    }
}

/// Targets grouped by the speed (and pitch correction) they get.
type SpeedTargets = Vec<((vv_core::Rational, bool), Vec<(usize, ClipId)>)>;

#[cfg(test)]
fn merged_attributes(
    source: &Clip,
    target: &Clip,
    selected: &HashSet<Attribute>,
    mode: KeyframeMode,
) -> ClipAttributes {
    merge(
        source,
        target,
        selected,
        &Conversion::paste(source, target, mode),
    )
}

#[cfg(test)]
#[path = "tests/paste_attributes.rs"]
mod tests;
