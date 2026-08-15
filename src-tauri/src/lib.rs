mod server;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// The desktop UI calls this once at startup to show "connect your phone to:"
// -- the LAN IP a phone on the same network (or Tailscale) would use to reach
// the embedded controller server (see server.rs).
#[tauri::command]
fn controller_url() -> String {
    format!("http://{}:{}", server::local_ip(), server::PORT)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, controller_url])
        .setup(|_app| {
            tauri::async_runtime::spawn(server::start());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
