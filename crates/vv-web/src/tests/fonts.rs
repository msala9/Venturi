use super::*;

#[test]
fn native_font_catalog_fallback_and_nonstandard_faces_preserve_desktop_choices() {
    let fallback = family_entry("", vec![]);
    assert_eq!(fallback["family"], "");
    assert_eq!(fallback["name"], "Sans-serif");
    let expected: Vec<_> = [(400, false), (700, false), (400, true), (700, true)]
        .map(|(weight, italic)| json!({"weight":weight,"italic":italic,"name":face_name(weight, italic)})).into();
    assert_eq!(fallback["faces"], json!(expected));
    assert_eq!(
        family_entry("Absent native family", vec![])["faces"],
        fallback["faces"]
    );
    let face = FontFace {
        weight: 1000,
        italic: true,
        name: face_name(1000, true),
    };
    let native = family_entry("Installed family", vec![face.clone()]);
    assert_eq!(native["name"], "Installed family");
    assert_eq!(
        native["faces"],
        json!([{"weight":1000,"italic":true,"name":face.name}])
    );
    let catalog = json!({"families":[fallback,native]});
    assert!(catalog_supports_style(&catalog, 1000, true));
    for (weight, italic) in [(1000, false), (999, true)] {
        assert!(!catalog_supports_style(&catalog, weight, italic));
    }
    assert!(!catalog_supports_style(
        &json!({"families":[family_entry("", vec![])]}),
        1000,
        true
    ));
}

#[tokio::test]
async fn native_font_catalog_matches_installed_native_families_faces_and_is_cached() {
    let (first, concurrent) = tokio::join!(catalog(), catalog());
    let first = first.unwrap();
    assert!(Arc::ptr_eq(&first, &concurrent.unwrap()));
    assert!(Arc::ptr_eq(&first, &catalog().await.unwrap()));
    let expected = tokio::task::spawn_blocking(|| {
        std::iter::once(String::new())
            .chain(font_families())
            .map(|family| {
                let faces = font_faces(&family);
                (family.clone(), family_entry(&family, faces))
            })
            .collect::<Vec<_>>()
    })
    .await
    .unwrap();
    let families = first["families"].as_array().unwrap();
    assert_eq!(families.len(), expected.len());
    for (actual, (family, native)) in families.iter().zip(expected) {
        assert_eq!(actual["family"], family);
        assert_eq!(*actual, native);
        assert!(!actual["faces"].as_array().unwrap().is_empty());
        for face in actual["faces"].as_array().unwrap() {
            assert!(supports_style(
                face["weight"].as_u64().unwrap().try_into().unwrap(),
                face["italic"].as_bool().unwrap()
            ));
        }
    }
}
