use crate::{compound_navigation::Ancestor, preview::FrameQuery};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use vv_core::{Id, Project, ProjectView, TimelineId};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub client_id: String,
    pub query: FrameQuery,
    pub if_view_revision: String,
    pub ancestors: Vec<Ancestor>,
    #[serde(default)]
    pub persist: bool,
}

pub fn normalized(project: &Project) -> ProjectView {
    ProjectView {
        active_timeline: project
            .view
            .active_timeline
            .filter(|id| project.timelines.contains_key(*id)),
        playheads: project
            .view
            .playheads
            .iter()
            .filter_map(|(&id, &frame)| {
                project
                    .timelines
                    .get(id)
                    .map(|timeline| (id, frame.clamp(0, (timeline.total_frames() - 1).max(0))))
            })
            .collect(),
    }
}
pub fn record(project: &Project, id: TimelineId, frame: i64) -> ProjectView {
    let mut view = normalized(project);
    let end = (project.timelines[id].total_frames() - 1).max(0);
    view.active_timeline = Some(id);
    view.playheads.insert(id, frame.clamp(0, end));
    view
}
pub fn snapshot(project: &Project) -> (Value, String) {
    let view = normalized(project);
    let value = json!({
        "active_timeline":view.active_timeline.map(|id| id.raw().to_string()),
        "playheads":view.playheads.iter().map(|(id,frame)|(id.raw().to_string(),json!(frame))).collect::<serde_json::Map<_,_>>(),
    });
    let revision = format!("{:x}", Sha256::digest(value.to_string().as_bytes()));
    (value, revision)
}

#[cfg(test)]
#[path = "tests/project_view.rs"]
mod tests;
