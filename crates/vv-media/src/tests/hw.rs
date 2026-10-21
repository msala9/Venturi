use super::*;

#[test]
fn web_cached_device_release_preserves_independent_refs_and_unrequested_entries() {
    let selected = HwDevice::Vulkan(Some("web-cache-release-selected".into()));
    let untouched = HwDevice::Vulkan(Some("web-cache-release-untouched".into()));
    let unavailable = HwDevice::Vulkan(Some("web-cache-release-unavailable".into()));
    let unknown = HwDevice::Vulkan(Some("web-cache-release-unknown".into()));
    // Ordinary CPU AVBuffers exercise the same reference ownership as hardware
    // devices without opening any driver or GPU context.
    let (mut held, mut other) = unsafe {
        let selected_buffer = ffi::av_buffer_alloc(1);
        let untouched_buffer = ffi::av_buffer_alloc(1);
        assert!(!selected_buffer.is_null() && !untouched_buffer.is_null());
        *(*selected_buffer).data = 17;
        let held = ffi::av_buffer_ref(selected_buffer);
        let other = ffi::av_buffer_ref(untouched_buffer);
        assert!(!held.is_null() && !other.is_null());
        let mut cached = DEVICES.lock().unwrap();
        assert!(
            cached
                .insert(selected.clone(), Some(DeviceRef(selected_buffer)))
                .is_none()
        );
        assert!(
            cached
                .insert(untouched.clone(), Some(DeviceRef(untouched_buffer)))
                .is_none()
        );
        assert!(cached.insert(unavailable.clone(), None).is_none());
        (held, other)
    };
    unsafe {
        assert_eq!(ffi::av_buffer_get_ref_count(held), 2);
        assert_eq!(ffi::av_buffer_get_ref_count(other), 2);
    }

    release_cached_devices(&[
        selected.clone(),
        selected.clone(),
        unavailable.clone(),
        unknown.clone(),
    ]);
    {
        let cached = DEVICES.lock().unwrap();
        assert!(!cached.contains_key(&selected));
        assert!(!cached.contains_key(&unknown));
        assert!(matches!(cached.get(&unavailable), Some(None)));
        assert!(matches!(cached.get(&untouched), Some(Some(_))));
    }
    assert!(known_unavailable(&unavailable));
    unsafe {
        assert_eq!(
            ffi::av_buffer_get_ref_count(held),
            1,
            "cache reference was unrefed"
        );
        assert_eq!(
            *(*held).data,
            17,
            "independent decoder reference remains alive"
        );
        assert_eq!(
            ffi::av_buffer_get_ref_count(other),
            2,
            "other devices stay cached"
        );
    }
    release_cached_devices(&[selected, untouched]);
    unsafe {
        assert_eq!(
            ffi::av_buffer_get_ref_count(held),
            1,
            "repeat release is harmless"
        );
        assert_eq!(ffi::av_buffer_get_ref_count(other), 1);
        ffi::av_buffer_unref(&mut held);
        ffi::av_buffer_unref(&mut other);
    }
    DEVICES.lock().unwrap().remove(&unavailable);
}
