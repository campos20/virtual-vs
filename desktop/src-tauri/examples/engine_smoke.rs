//! Exercises the real engine on a real output device, without the UI:
//! decode -> open device -> play -> seek -> pause -> resume -> stop.
//!
//!   cargo run --example engine_smoke                 # synthesized test song
//!   cargo run --example engine_smoke -- <project>    # a real project folder
//!   cargo run --example engine_smoke -- <project> <device-id>
//!
//! Prints the available devices first; pass one's id to test an interface.

use std::path::PathBuf;
use std::thread::sleep;
use std::time::Duration;

use virtual_vs_desktop_lib::engine::{self, device, Engine};
use virtual_vs_desktop_lib::project;
use virtual_vs_desktop_lib::routing::{MonitorMode, RoutingConfig};

fn write_sine_wav(path: &std::path::Path, freq: f32, seconds: f32) {
    let rate = 44_100u32;
    let frames = (rate as f32 * seconds) as u32;
    let mut bytes = Vec::new();
    let data_len = frames * 2;
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    for v in [1u16, 1] {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&(rate * 2).to_le_bytes());
    for v in [2u16, 16] {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    for i in 0..frames {
        let s = (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin() * 0.08;
        bytes.extend_from_slice(&((s * i16::MAX as f32) as i16).to_le_bytes());
    }
    std::fs::write(path, bytes).unwrap();
}

fn synth_project() -> PathBuf {
    let dir = std::env::temp_dir().join("vvs-smoke-project");
    std::fs::create_dir_all(&dir).unwrap();
    write_sine_wav(&dir.join("low.wav"), 220.0, 6.0);
    write_sine_wav(&dir.join("high.wav"), 330.0, 6.0);
    std::fs::write(
        dir.join("manifest.json"),
        r#"{"id":"smoke","title":"Smoke test","bpm":100,"key":"A",
            "tracks":[{"id":"low","name":"Low","file":"low.wav","gain":1,"bus":"main"},
                      {"id":"high","name":"High","file":"high.wav","gain":1,"bus":"cue"}],
            "sections":[]}"#,
    )
    .unwrap();
    dir
}

fn status(engine: &mut Engine, label: &str) {
    let s = engine.status();
    println!(
        "{label:<10} {:?} at {:.3}s / {:.3}s  xruns={} error={:?}",
        s.transport, s.position_sec, s.duration_sec, s.xruns, s.device_error
    );
}

fn main() {
    println!("Output devices:");
    for d in device::list_output_devices() {
        println!(
            "  {}{} - {} ch @ {} Hz  [{}]",
            d.name,
            if d.is_default { " (default)" } else { "" },
            d.max_channels,
            d.default_sample_rate,
            d.id
        );
    }

    let mut args = std::env::args().skip(1);
    let dir = args.next().map(PathBuf::from).unwrap_or_else(synth_project);
    let device_id = args.next();

    let mut engine = Engine::new(MonitorMode::Split, RoutingConfig::default());
    engine.open_device(device_id, None).expect("open device");
    let out = engine.output_info().unwrap().clone();
    println!(
        "\nOpened {} - {} ch @ {} Hz",
        out.name, out.channels, out.sample_rate
    );

    let manifest = project::read_manifest(&dir).expect("manifest");
    let started = std::time::Instant::now();
    let loaded = engine::decode_project(&dir, manifest, out.sample_rate, &|c, t, name| {
        if c > 0 {
            println!("  decoded {c}/{t} {name}");
        }
    })
    .expect("decode");
    println!("Decoded in {:?}", started.elapsed());
    engine.install_project(loaded).expect("install");
    sleep(Duration::from_millis(50));

    engine.play();
    sleep(Duration::from_millis(1500));
    status(&mut engine, "playing");
    engine.seek(3.0);
    sleep(Duration::from_millis(500));
    status(&mut engine, "seeked");
    engine.pause();
    sleep(Duration::from_millis(300));
    status(&mut engine, "paused");
    engine.play();
    sleep(Duration::from_millis(500));
    status(&mut engine, "resumed");
    engine.stop();
    sleep(Duration::from_millis(100));
    status(&mut engine, "stopped");
    engine.collect_garbage();
}
