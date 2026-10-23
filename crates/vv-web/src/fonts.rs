use crate::error::{ApiError, Result};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::OnceCell;
use vv_render::text::{FontFace, face_name, font_faces, font_families};

static CATALOG: OnceCell<Arc<Value>> = OnceCell::const_new();

fn family_entry(family: &str, mut faces: Vec<FontFace>) -> Value {
    if faces.is_empty() {
        faces = [(400, false), (700, false), (400, true), (700, true)]
            .map(|(weight, italic)| FontFace {
                weight,
                italic,
                name: face_name(weight, italic),
            })
            .into();
    }
    json!({"family":family,"name":if family.is_empty() { "Sans-serif" } else { family },
        "faces":faces.into_iter().map(|face|json!({"weight":face.weight,"italic":face.italic,"name":face.name})).collect::<Vec<_>>()})
}

fn native_catalog() -> Value {
    let families: Vec<_> = std::iter::once(String::new())
        .chain(font_families())
        .map(|family| family_entry(&family, font_faces(&family)))
        .collect();
    json!({"families":families})
}

pub async fn catalog() -> Result<Arc<Value>> {
    let value = CATALOG
        .get_or_try_init(|| async {
            tokio::task::spawn_blocking(|| Arc::new(native_catalog()))
                .await
                .map_err(|_| {
                    ApiError(
                        axum::http::StatusCode::SERVICE_UNAVAILABLE,
                        "FONT_CATALOG_UNAVAILABLE",
                        "The native font catalog is unavailable",
                    )
                })
        })
        .await?;
    Ok(value.clone())
}

fn catalog_supports_style(catalog: &Value, weight: u16, italic: bool) -> bool {
    catalog["families"].as_array().is_some_and(|families| {
        families.iter().any(|entry| {
            entry["faces"].as_array().is_some_and(|faces| {
                faces.iter().any(|face| {
                    face["weight"].as_u64() == Some(u64::from(weight))
                        && face["italic"].as_bool() == Some(italic)
                })
            })
        })
    })
}

pub(crate) fn supports_style(weight: u16, italic: bool) -> bool {
    CATALOG
        .get()
        .is_some_and(|catalog| catalog_supports_style(catalog, weight, italic))
}

#[cfg(test)]
#[path = "tests/fonts.rs"]
mod tests;
