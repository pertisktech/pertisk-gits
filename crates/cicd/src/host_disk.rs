use std::ffi::OsStr;
use std::path::Path;

use sysinfo::{Disk, Disks};

const VIRTUAL_FILESYSTEMS: &[&str] = &[
    "tmpfs",
    "devtmpfs",
    "devfs",
    "proc",
    "sysfs",
    "cgroup",
    "cgroup2",
    "overlay",
    "squashfs",
    "autofs",
    "fusectl",
    "securityfs",
    "pstore",
    "bpf",
    "tracefs",
    "debugfs",
    "configfs",
    "mqueue",
    "hugetlbfs",
    "rpc_pipefs",
    "nfsd",
    "binfmt_misc",
];

pub fn is_virtual_filesystem(file_system: &OsStr) -> bool {
    file_system
        .to_str()
        .map(|name| {
            VIRTUAL_FILESYSTEMS
                .iter()
                .any(|virtual_fs| name.eq_ignore_ascii_case(virtual_fs))
        })
        .unwrap_or(true)
}

fn is_physical_disk(disk: &Disk) -> bool {
    !is_virtual_filesystem(disk.file_system())
}

/// Returns disk usage for the primary server filesystem.
///
/// Uses the root mount (`/`) when present so totals match `df /` instead of
/// summing every mount (tmpfs, /boot, duplicate subvolume sizes, etc.).
pub fn disk_usage_bytes(disks: &Disks) -> (u64, u64) {
    let physical: Vec<_> = disks.list().iter().filter(|disk| is_physical_disk(disk)).collect();

    if let Some(root) = physical
        .iter()
        .find(|disk| disk.mount_point() == Path::new("/"))
    {
        return (root.total_space(), root.available_space());
    }

    physical
        .into_iter()
        .max_by_key(|disk| disk.total_space())
        .map(|disk| (disk.total_space(), disk.available_space()))
        .unwrap_or((0, 0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn virtual_filesystems_are_detected() {
        assert!(is_virtual_filesystem(OsStr::new("tmpfs")));
        assert!(is_virtual_filesystem(OsStr::new("devtmpfs")));
        assert!(is_virtual_filesystem(OsStr::new("overlay")));
        assert!(!is_virtual_filesystem(OsStr::new("ext4")));
        assert!(!is_virtual_filesystem(OsStr::new("xfs")));
    }

    #[test]
    fn disk_usage_smoke() {
        let disks = Disks::new_with_refreshed_list();
        let (total, free) = disk_usage_bytes(&disks);
        assert!(free <= total);
    }
}
