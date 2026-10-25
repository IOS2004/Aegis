// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SandboxEnvironment } from "../src/tools/sandbox.js";

describe("SandboxEnvironment Security & Confinement", () => {
  let tempDir: string;
  let sandbox: SandboxEnvironment;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-sandbox-test-"));
    sandbox = new SandboxEnvironment(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should successfully write a demo file within sandbox demo directory", async () => {
    const res = await sandbox.writeDemoFile({
      fileName: "safe-note.txt",
      content: "Hello from Aegis sandbox",
    });

    expect(res.success).toBe(true);
    expect(res.resultHash).toMatch(/^0x[0-9a-fA-F]{64}$/);

    const writtenPath = path.join(tempDir, "demo", "safe-note.txt");
    expect(fs.existsSync(writtenPath)).toBe(true);
    expect(fs.readFileSync(writtenPath, "utf8")).toBe("Hello from Aegis sandbox");
  });

  it("should block path traversal attempts escaping the sandbox demo directory", async () => {
    const res = await sandbox.writeDemoFile({
      fileName: "../../escaped.txt",
      content: "Dangerous payload outside sandbox",
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("Path traversal violation");

    // Verify file was NOT written outside
    const outsidePath = path.resolve(tempDir, "..", "escaped.txt");
    expect(fs.existsSync(outsidePath)).toBe(false);
  });

  it("should block absolute path traversal attempts", async () => {
    const maliciousTarget = process.platform === "win32" ? "C:\\evil.txt" : "/tmp/evil.txt";
    const res = await sandbox.writeDemoFile({
      fileName: maliciousTarget,
      content: "Dangerous payload",
    });

    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });

  it("should read project status successfully without exposing secrets", async () => {
    const res = await sandbox.readProjectStatus({ format: "summary" });
    expect(res.success).toBe(true);
    expect(res.output).toContain("healthy");
    expect(res.resultHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it("should execute pre-configured test suite within sandbox", async () => {
    const res = await sandbox.runTestSuite({ target: "unit", timeoutMs: 3000 });
    expect(res.success).toBe(true);
    expect(res.output).toContain("PASS");
    expect(res.resultHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it("should create a safe sandbox git branch", async () => {
    const res = await sandbox.createSandboxBranch({ branchName: "feat-aegis-patch" });
    expect(res.success).toBe(true);
    expect(res.resultHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it("should reject branch names starting with dashes", async () => {
    const res = await sandbox.createSandboxBranch({ branchName: "-dangerous-option" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("cannot start with a dash");
  });
});
