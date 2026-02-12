import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getQueryFn } from "@/lib/queryClient";

type AdminUser = {
  email: string;
  name: string;
  role: string;
} | null;

export function useAdminAuth() {
  const { data: admin, isLoading } = useQuery<AdminUser>({
    queryKey: ["/api/admin/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest("POST", "/api/admin/login", { email });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/me"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/admin/me"], null);
    },
  });

  const isAuthenticated = !!admin;

  return {
    admin: admin || undefined,
    isLoading,
    isAuthenticated,
    login: loginMutation,
    logout: logoutMutation,
  };
}
