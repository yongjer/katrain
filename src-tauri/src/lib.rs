mod engine;
mod files;
mod models;
mod paths;

use tauri::RunEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(engine::EngineState::default())
        .manage(models::Downloads::default())
        .invoke_handler(tauri::generate_handler![
            engine::engine_start,
            engine::engine_send,
            engine::engine_stop,
            files::read_game_file,
            files::write_text_file,
            files::load_config,
            files::save_config,
            files::fetch_text,
            models::list_models,
            models::resolve_model_endpoint,
            models::download_model,
        ])
        .build(tauri::generate_context!())
        .expect("error while building KaTrain");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            engine::shutdown(handle);
        }
    });
}
