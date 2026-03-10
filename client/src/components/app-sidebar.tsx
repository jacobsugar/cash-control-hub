import { useLocation, Link } from "wouter";
import {
  LayoutDashboard,
  Calculator,
  Receipt,
  Bell,
  MapPin,
  Building2,
  Users,
  Phone,
  FileSpreadsheet,
  Wallet,
  Shield,
  Settings,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import helloSugarLogo from "@assets/Logo_for_Swag_(1)_1770876580780.png";

const mainItems = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
  { title: "Shift Counts", url: "/admin/shifts", icon: Calculator },
  { title: "Receipts", url: "/admin/receipts", icon: Receipt },
  { title: "Alerts", url: "/admin/alerts", icon: Bell },
  { title: "Collections", url: "/admin/collections", icon: Wallet },
];

const dataItems = [
  { title: "Boulevard Import", url: "/admin/boulevard", icon: FileSpreadsheet },
];

const settingsItems = [
  { title: "Markets", url: "/admin/markets", icon: MapPin },
  { title: "Locations", url: "/admin/locations", icon: Building2 },
  { title: "Estheticians", url: "/admin/estheticians", icon: Users },
  { title: "Alert Recipients", url: "/admin/recipients", icon: Phone },
  { title: "Admin Users", url: "/admin/users", icon: Shield },
  { title: "Settings", url: "/admin/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { setOpenMobile, isMobile } = useSidebar();

  const handleLinkClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/admin" data-testid="link-admin-home" onClick={handleLinkClick}>
          <div className="flex items-center gap-3">
            <img src={helloSugarLogo} alt="Hello Sugar" className="h-8 w-auto" data-testid="img-sidebar-logo" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight">CashControl</h2>
              <p className="text-[11px] text-muted-foreground leading-tight">by Hello Sugar</p>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Overview</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                  >
                    <Link href={item.url} onClick={handleLinkClick} data-testid={`link-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Data</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {dataItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                  >
                    <Link href={item.url} onClick={handleLinkClick} data-testid={`link-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Configuration</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                  >
                    <Link href={item.url} onClick={handleLinkClick} data-testid={`link-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <p className="text-xs text-muted-foreground">v1.0 &middot; CashControl by Hello Sugar</p>
      </SidebarFooter>
    </Sidebar>
  );
}
