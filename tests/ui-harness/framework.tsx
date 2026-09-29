import React from "react";
// Test-only identity and navigation adapters. Never imported by the application.
const getToken = async () => "synthetic-browser-token";
export const useAuth = () => ({
  userId: "synthetic-owner",
  isLoaded: true,
  isSignedIn: true,
  getToken,
});
export const useUser = () => ({
  user: { firstName: "Sam", fullName: "Sam" },
  isLoaded: true,
  isSignedIn: true,
});
export const ClerkProvider = ({ children }: React.PropsWithChildren) => (
  <>{children}</>
);
export const UserButton = () => (
  <button aria-label="Synthetic account" type="button">
    S
  </button>
);
export const usePathname = () => window.location.pathname;
export const useSearchParams = () =>
  new URLSearchParams(window.location.search);
export const useRouter = () => ({
  push: (path: string) => {
    window.location.href = path;
  },
  refresh: () => window.location.reload(),
});
export default function Link({
  href,
  children,
  ...props
}: React.PropsWithChildren<{ href: string }>) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}
