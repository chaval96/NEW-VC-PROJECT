import { validateStatusTransition } from "../index";
import { SubmissionRequestStatus } from "../domain/types";

describe("validateStatusTransition", () => {
  test("valid transitions from pending_approval", () => {
    expect(() => validateStatusTransition("pending_approval", "approved")).not.toThrow();
    expect(() => validateStatusTransition("pending_approval", "rejected")).not.toThrow();
  });

  test("invalid transitions from pending_approval", () => {
    expect(() => validateStatusTransition("pending_approval", "executing")).toThrow();
    expect(() => validateStatusTransition("pending_approval", "completed")).toThrow();
  });

  test("valid transitions from pending_retry", () => {
    expect(() => validateStatusTransition("pending_retry", "approved")).not.toThrow();
    expect(() => validateStatusTransition("pending_retry", "rejected")).not.toThrow();
    expect(() => validateStatusTransition("pending_retry", "executing")).not.toThrow();
  });

  test("invalid transitions from pending_retry", () => {
    expect(() => validateStatusTransition("pending_retry", "completed")).toThrow();
    expect(() => validateStatusTransition("pending_retry", "failed")).toThrow();
  });

  test("valid transitions from approved", () => {
    expect(() => validateStatusTransition("approved", "executing")).not.toThrow();
    expect(() => validateStatusTransition("approved", "rejected")).not.toThrow();
  });

  test("invalid transitions from approved", () => {
    expect(() => validateStatusTransition("approved", "completed")).toThrow();
    expect(() => validateStatusTransition("approved", "pending_approval")).toThrow();
  });

  test("valid transitions from executing", () => {
    expect(() => validateStatusTransition("executing", "completed")).not.toThrow();
    expect(() => validateStatusTransition("executing", "failed")).not.toThrow();
    expect(() => validateStatusTransition("executing", "pending_retry")).not.toThrow();
  });

  test("invalid transitions from executing", () => {
    expect(() => validateStatusTransition("executing", "approved")).toThrow();
    expect(() => validateStatusTransition("executing", "rejected")).toThrow();
  });

  test("terminal state completed", () => {
    expect(() => validateStatusTransition("completed", "approved")).toThrow();
    expect(() => validateStatusTransition("completed", "executing")).toThrow();
  });

  test("terminal state rejected", () => {
    expect(() => validateStatusTransition("rejected", "approved")).toThrow();
    expect(() => validateStatusTransition("rejected", "executing")).toThrow();
  });

  test("terminal state failed", () => {
    expect(() => validateStatusTransition("failed", "approved")).toThrow();
    expect(() => validateStatusTransition("failed", "executing")).toThrow();
  });
});
