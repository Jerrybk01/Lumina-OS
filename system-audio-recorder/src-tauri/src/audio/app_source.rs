//! Shared helpers for per-app source identifiers (platform-agnostic).

/// Parse a UI / IPC app-source id into a process id for OS process-loopback APIs.
///
/// Accepted forms:
/// - `None`, `""`, `"system"` → full system mix (no PID filter)
/// - `"pid:1234"` → PID 1234
/// - `"1234"` → PID 1234
pub fn parse_app_source_pid(app_source_id: Option<&str>) -> Option<u32> {
    let raw = app_source_id?.trim();
    if raw.is_empty() || raw.eq_ignore_ascii_case("system") {
        return None;
    }
    let digits = raw.strip_prefix("pid:").unwrap_or(raw);
    digits.parse().ok()
}

/// Format a PID as a stable app-source id used by the UI.
pub fn format_app_source_id(pid: u32) -> String {
    format!("pid:{pid}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_means_no_pid() {
        assert_eq!(parse_app_source_pid(None), None);
        assert_eq!(parse_app_source_pid(Some("")), None);
        assert_eq!(parse_app_source_pid(Some("system")), None);
        assert_eq!(parse_app_source_pid(Some("SYSTEM")), None);
    }

    #[test]
    fn parses_pid_forms() {
        assert_eq!(parse_app_source_pid(Some("pid:42")), Some(42));
        assert_eq!(parse_app_source_pid(Some("42")), Some(42));
        assert_eq!(parse_app_source_pid(Some("  pid:7  ")), Some(7));
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse_app_source_pid(Some("chrome")), None);
        assert_eq!(parse_app_source_pid(Some("pid:abc")), None);
    }

    #[test]
    fn formats_roundtrip() {
        let id = format_app_source_id(1234);
        assert_eq!(parse_app_source_pid(Some(&id)), Some(1234));
    }
}
