//! CoreAudio-based output-device switching.
//!
//! Uses raw FFI against AudioHardware so we don't need an extra crate.
//! Only the handful of symbols we need are declared inline.

use std::ffi::CStr;
use std::os::raw::c_void;

/// AudioObjectID and friends
type AudioObjectID = u32;
type AudioDeviceID = AudioObjectID;
type OSStatus = i32;

const K_AUDIO_OBJECT_SYSTEM_OBJECT: AudioObjectID = 1;

// Selectors
const K_AUDIO_HARDWARE_PROPERTY_DEVICES: u32 = u32::from_be_bytes(*b"dev#");
const K_AUDIO_HARDWARE_PROPERTY_DEFAULT_OUTPUT_DEVICE: u32 = u32::from_be_bytes(*b"dOut");
const K_AUDIO_DEVICE_PROPERTY_DEVICE_NAME_CFString: u32 = u32::from_be_bytes(*b"lnam");
const K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL: u32 = u32::from_be_bytes(*b"glob");
const K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN: u32 = 0;
const K_AUDIO_DEVICE_PROPERTY_STREAMS: u32 = u32::from_be_bytes(*b"stm#");
const K_AUDIO_OBJECT_PROPERTY_SCOPE_OUTPUT: u32 = u32::from_be_bytes(*b"outp");

#[repr(C)]
struct AudioObjectPropertyAddress {
    selector: u32,
    scope: u32,
    element: u32,
}

extern "C" {
    fn AudioObjectGetPropertyDataSize(
        id: AudioObjectID,
        address: *const AudioObjectPropertyAddress,
        qualifier_data_size: u32,
        qualifier_data: *const c_void,
        out_data_size: *mut u32,
    ) -> OSStatus;

    fn AudioObjectGetPropertyData(
        id: AudioObjectID,
        address: *const AudioObjectPropertyAddress,
        qualifier_data_size: u32,
        qualifier_data: *const c_void,
        io_data_size: *mut u32,
        out_data: *mut c_void,
    ) -> OSStatus;

    fn AudioObjectSetPropertyData(
        id: AudioObjectID,
        address: *const AudioObjectPropertyAddress,
        qualifier_data_size: u32,
        qualifier_data: *const c_void,
        data_size: u32,
        data: *const c_void,
    ) -> OSStatus;

    // CoreFoundation helpers for CFString -> Rust string
    fn CFStringGetCStringPtr(the_string: *const c_void, encoding: u32) -> *const i8;
    fn CFStringGetCString(
        the_string: *const c_void,
        buffer: *mut i8,
        buffer_size: i64,
        encoding: u32,
    ) -> bool;
    fn CFRelease(cf: *const c_void);
}

const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;

fn cfstring_to_string(cf: *const c_void) -> String {
    if cf.is_null() {
        return String::new();
    }
    unsafe {
        let ptr = CFStringGetCStringPtr(cf, K_CF_STRING_ENCODING_UTF8);
        if !ptr.is_null() {
            return CStr::from_ptr(ptr).to_string_lossy().into_owned();
        }
        let mut buf = [0i8; 512];
        if CFStringGetCString(cf, buf.as_mut_ptr(), buf.len() as i64, K_CF_STRING_ENCODING_UTF8) {
            CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned()
        } else {
            String::new()
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AudioOutputDevice {
    pub id: u32,
    pub name: String,
}

/// Returns all audio devices that have output streams (i.e. speakers, headphones, BlackHole).
pub fn list_output_devices() -> Result<Vec<AudioOutputDevice>, String> {
    unsafe {
        let addr = AudioObjectPropertyAddress {
            selector: K_AUDIO_HARDWARE_PROPERTY_DEVICES,
            scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
            element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
        };

        let mut size: u32 = 0;
        let status = AudioObjectGetPropertyDataSize(
            K_AUDIO_OBJECT_SYSTEM_OBJECT,
            &addr,
            0,
            std::ptr::null(),
            &mut size,
        );
        if status != 0 {
            return Err(format!("AudioObjectGetPropertyDataSize failed: {status}"));
        }

        let count = size as usize / std::mem::size_of::<AudioDeviceID>();
        let mut device_ids = vec![0u32; count];

        let status = AudioObjectGetPropertyData(
            K_AUDIO_OBJECT_SYSTEM_OBJECT,
            &addr,
            0,
            std::ptr::null(),
            &mut size,
            device_ids.as_mut_ptr() as *mut c_void,
        );
        if status != 0 {
            return Err(format!("AudioObjectGetPropertyData failed: {status}"));
        }

        let mut devices = Vec::new();

        for &dev_id in &device_ids {
            // Check if device has output streams
            let stream_addr = AudioObjectPropertyAddress {
                selector: K_AUDIO_DEVICE_PROPERTY_STREAMS,
                scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_OUTPUT,
                element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
            };
            let mut stream_size: u32 = 0;
            let status = AudioObjectGetPropertyDataSize(
                dev_id,
                &stream_addr,
                0,
                std::ptr::null(),
                &mut stream_size,
            );
            if status != 0 || stream_size == 0 {
                continue; // No output streams
            }

            // Get device name
            let name_addr = AudioObjectPropertyAddress {
                selector: K_AUDIO_DEVICE_PROPERTY_DEVICE_NAME_CFString,
                scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
                element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
            };
            let mut cf_name: *const c_void = std::ptr::null();
            let mut name_size = std::mem::size_of::<*const c_void>() as u32;
            let status = AudioObjectGetPropertyData(
                dev_id,
                &name_addr,
                0,
                std::ptr::null(),
                &mut name_size,
                &mut cf_name as *mut _ as *mut c_void,
            );
            if status != 0 || cf_name.is_null() {
                continue;
            }

            let name = cfstring_to_string(cf_name);
            CFRelease(cf_name);

            if !name.is_empty() {
                devices.push(AudioOutputDevice { id: dev_id, name });
            }
        }

        Ok(devices)
    }
}

/// Returns the current default output device ID.
pub fn get_default_output_device() -> Result<AudioDeviceID, String> {
    unsafe {
        let addr = AudioObjectPropertyAddress {
            selector: K_AUDIO_HARDWARE_PROPERTY_DEFAULT_OUTPUT_DEVICE,
            scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
            element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
        };

        let mut dev_id: AudioDeviceID = 0;
        let mut size = std::mem::size_of::<AudioDeviceID>() as u32;

        let status = AudioObjectGetPropertyData(
            K_AUDIO_OBJECT_SYSTEM_OBJECT,
            &addr,
            0,
            std::ptr::null(),
            &mut size,
            &mut dev_id as *mut _ as *mut c_void,
        );
        if status != 0 {
            return Err(format!("Failed to get default output device: {status}"));
        }

        Ok(dev_id)
    }
}

/// Sets the default output device by AudioDeviceID.
pub fn set_default_output_device(device_id: AudioDeviceID) -> Result<(), String> {
    unsafe {
        let addr = AudioObjectPropertyAddress {
            selector: K_AUDIO_HARDWARE_PROPERTY_DEFAULT_OUTPUT_DEVICE,
            scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
            element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
        };

        let status = AudioObjectSetPropertyData(
            K_AUDIO_OBJECT_SYSTEM_OBJECT,
            &addr,
            0,
            std::ptr::null(),
            std::mem::size_of::<AudioDeviceID>() as u32,
            &device_id as *const _ as *const c_void,
        );
        if status != 0 {
            return Err(format!("Failed to set output device: {status}"));
        }

        Ok(())
    }
}

/// Find a device by name (case-insensitive substring match).
pub fn find_device_by_name(name: &str) -> Result<Option<AudioOutputDevice>, String> {
    let devices = list_output_devices()?;
    let lower = name.to_lowercase();
    Ok(devices.into_iter().find(|d| d.name.to_lowercase().contains(&lower)))
}
