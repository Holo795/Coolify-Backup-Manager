import { LayoutDashboard, Server, Boxes, HardDrive, Archive, Cpu, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Scheduling lives on each instance (default schedule) and resource (override),
// so there is no separate "Policies" page in the primary navigation.
export const NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/instances", label: "Coolify instances", icon: Server },
  { href: "/resources", label: "Resources", icon: Boxes },
  { href: "/destinations", label: "Destinations", icon: HardDrive },
  { href: "/snapshots", label: "Snapshots", icon: Archive },
  { href: "/agents", label: "Agents", icon: Cpu },
];
