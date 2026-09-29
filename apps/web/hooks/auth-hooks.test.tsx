import { renderHook } from "@testing-library/react";
import { useAuthStatus } from "./use-auth-status";
import { useAppUserId } from "./use-app-user-id";
let mockAuth: {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
} = { isLoaded: false, isSignedIn: false, userId: null };
jest.mock("@clerk/nextjs", () => ({ useAuth: () => mockAuth }));
test("identity transition preserves loading, signed-out and per-account cache identity", () => {
  const { result, rerender } = renderHook(() => ({
    status: useAuthStatus().status,
    id: useAppUserId(),
  }));
  expect(result.current).toEqual({ status: "loading", id: undefined });
  mockAuth = { isLoaded: true, isSignedIn: false, userId: null };
  rerender();
  expect(result.current).toEqual({ status: "unauthenticated", id: undefined });
  mockAuth = { isLoaded: true, isSignedIn: true, userId: "owner" };
  rerender();
  expect(result.current).toEqual({ status: "authenticated", id: "owner" });
  mockAuth = { ...mockAuth, userId: "second" };
  rerender();
  expect(result.current.id).toBe("second");
});
