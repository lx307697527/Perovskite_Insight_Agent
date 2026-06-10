use tauri_plugin_shell::ShellExt;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Perovskite Insight Agent.", name)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|app| {
            // 在开发模式下自动启动 Python Sidecar
            #[cfg(debug_assertions)]
            {
                let shell = app.shell();
                // 尝试启动 Python 后端
                // 首先尝试 .venv 中的 Python
                let venv_python = std::path::PathBuf::from("..")
                    .join(".venv")
                    .join("Scripts")
                    .join("python.exe");

                let python_path = if venv_python.exists() {
                    venv_python.to_string_lossy().to_string()
                } else {
                    // 回退到系统 Python
                    "python".to_string()
                };

                log::info!("Starting Python sidecar with: {}", python_path);

                let main_py = std::path::PathBuf::from("..")
                    .join("src-python")
                    .join("main.py");

                match shell.command(&python_path)
                    .args([main_py.to_string_lossy().to_string()])
                    .current_dir(std::path::PathBuf::from("..").join("src-python"))
                    .spawn()
                {
                    Ok((mut _rx, _child)) => {
                        log::info!("Python sidecar started successfully");
                    }
                    Err(e) => {
                        log::error!("Failed to start Python sidecar: {}", e);
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
