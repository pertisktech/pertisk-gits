use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use sysinfo::{Disks, Pid, ProcessRefreshKind, System};

#[derive(Debug, Serialize)]
pub struct HostMetrics {
    pub hostname: String,
    pub cpu_cores: u32,
    pub cpu_usage_percent: f32,
    pub memory_total_bytes: u64,
    pub memory_used_bytes: u64,
    pub disk_total_bytes: u64,
    pub disk_used_bytes: u64,
    pub disk_free_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct ProcessMetrics {
    pub pid: u32,
    pub memory_bytes: u64,
    pub cpu_usage_percent: f32,
}

pub fn collect_host_metrics() -> HostMetrics {
    let mut system = System::new_all();
    system.refresh_all();
    std::thread::sleep(Duration::from_millis(200));
    system.refresh_cpu_all();

    let memory_total_bytes = system.total_memory();
    let memory_used_bytes = system.used_memory();
    let cpu_cores = system.cpus().len().max(1) as u32;
    let cpu_usage_percent = system.global_cpu_usage();

    let disks = Disks::new_with_refreshed_list();
    let (disk_total_bytes, disk_free_bytes) =
        disks.list().iter().fold((0u64, 0u64), |(total, free), disk| {
            (
                total.saturating_add(disk.total_space()),
                free.saturating_add(disk.available_space()),
            )
        });
    let disk_used_bytes = disk_total_bytes.saturating_sub(disk_free_bytes);

    HostMetrics {
        hostname: System::host_name().unwrap_or_else(|| "unknown".into()),
        cpu_cores,
        cpu_usage_percent,
        memory_total_bytes,
        memory_used_bytes,
        disk_total_bytes,
        disk_used_bytes,
        disk_free_bytes,
    }
}

pub fn collect_process_metrics() -> ProcessMetrics {
    let pid = Pid::from_u32(std::process::id());
    let mut system = System::new();
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::Some(&[pid]),
        false,
        ProcessRefreshKind::everything(),
    );
    std::thread::sleep(Duration::from_millis(200));
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::Some(&[pid]),
        false,
        ProcessRefreshKind::everything(),
    );

    let (memory_bytes, cpu_usage_percent) = system
        .process(pid)
        .map(|process| (process.memory(), process.cpu_usage()))
        .unwrap_or((0, 0.0));

    ProcessMetrics {
        pid: pid.as_u32(),
        memory_bytes,
        cpu_usage_percent,
    }
}

pub fn directory_size_bytes(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }

    let metadata = match std::fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(_) => return 0,
    };

    if metadata.file_type().is_symlink() {
        return 0;
    }

    if metadata.is_file() {
        return metadata.len();
    }

    let mut total = 0u64;
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return 0,
    };

    for entry in entries.flatten() {
        total = total.saturating_add(directory_size_bytes(&entry.path()));
    }

    total
}
