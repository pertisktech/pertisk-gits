use std::net::UdpSocket;

use serde::Serialize;
use sysinfo::{Disks, System};

use crate::version::APP_VERSION;

#[derive(Debug, Clone, Serialize)]
pub struct HostInfo {
    pub version: String,
    pub host_name: String,
    pub host_ip: Option<String>,
    pub cpu_cores: u32,
    pub memory_total_mb: u64,
    pub memory_used_mb: u64,
    pub disk_total_mb: u64,
    pub disk_free_mb: u64,
}

pub fn collect_host_info() -> HostInfo {
    let mut system = System::new_all();
    system.refresh_all();

    let memory_total_mb = system.total_memory() / 1024 / 1024;
    let memory_used_mb = system.used_memory() / 1024 / 1024;
    let cpu_cores = system.cpus().len().max(1) as u32;

    let disks = Disks::new_with_refreshed_list();
    let (disk_total_mb, disk_free_mb) = disks.list().iter().fold((0u64, 0u64), |(total, free), disk| {
        (
            total.saturating_add(disk.total_space() / 1024 / 1024),
            free.saturating_add(disk.available_space() / 1024 / 1024),
        )
    });

    HostInfo {
        version: APP_VERSION.to_string(),
        host_name: std::env::var("HOSTNAME")
            .ok()
            .filter(|name| !name.is_empty())
            .or_else(|| System::host_name())
            .unwrap_or_else(|| "unknown".into()),
        host_ip: detect_local_ip(),
        cpu_cores,
        memory_total_mb,
        memory_used_mb,
        disk_total_mb,
        disk_free_mb,
    }
}

fn detect_local_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}
