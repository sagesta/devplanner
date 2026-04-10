import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, jest } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAddToSprint } from "../hooks/useAddToSprint";
import * as api from "../lib/api";

jest.mock("../lib/api", () => ({
  patchTask: jest.fn(),
}));

describe("useAddToSprint", () => {
  it("calls patchTask with expected variables and invalidates queries on success", async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
    
    (api.patchTask as jest.Mock).mockResolvedValue({});

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useAddToSprint(), { wrapper });

    result.current.mutate({ taskId: "t1", sprintId: "s1" });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(api.patchTask).toHaveBeenCalledWith("t1", { sprintId: "s1", status: "todo" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["sprintTasks", "s1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["backlog"] });
  });
});
