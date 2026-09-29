import {
  authHeaders,
  getAuthToken,
  registerAuthTokenGetter,
} from "./auth-token";

describe("auth token bridge", () => {
  test("attaches the current token to API requests", async () => {
    const getter = jest
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");
    registerAuthTokenGetter(getter);

    expect(await authHeaders()).toEqual({ Authorization: "Bearer first" });
    expect(await authHeaders()).toEqual({ Authorization: "Bearer second" });
    expect(getter).toHaveBeenCalledTimes(2);
  });

  test("omits credentials when signed out or the provider fails", async () => {
    registerAuthTokenGetter(async () => null);
    expect(await authHeaders()).toEqual({});

    registerAuthTokenGetter(async () => {
      throw new Error("session expired");
    });
    expect(await getAuthToken()).toBeNull();
    expect(await authHeaders()).toEqual({});
  });
});
