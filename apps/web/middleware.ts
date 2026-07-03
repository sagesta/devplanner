import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// "/" is the landing redirect (and the target of infra health probes) — public.
const isPublicRoute = createRouteMatcher(["/", "/login(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Everything except Next internals and static files…
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // …plus API routes (the goals BFF reads auth()) and Clerk's proxy path.
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
