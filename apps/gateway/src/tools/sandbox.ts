// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import type {
  CreateSandboxBranchParams,
  ReadProjectStatusParams,
  RunTestSuiteParams,
  WriteDemoFileParams,
} from "@aegis/shared";

const execFileAsync = promisify(execFile);

export interface ToolExecutionResult {
  success: boolean;
  toolName: string;
  output: string;
  resultHash: `0x${string}`;
  durationMs: number;
  error?: string;
}

export class SandboxEnvironment {
  public readonly rootDir: string;
  public readonly demoDir: string;
  public readonly maxOutputBytes = 50 * 1024; // 50 KB ceiling

  constructor(baseDir?: string) {
    this.rootDir = path.resolve(baseDir ?? path.join(process.cwd(), "scratch", "sandbox"));
    this.demoDir = path.join(this.rootDir, "demo");
    this.init();
  }

  private init() {
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
    if (!fs.existsSync(this.demoDir)) {
      fs.mkdirSync(this.demoDir, { recursive: true });
    }

    // Initialize sandbox git repo if not present
    const gitDir = path.join(this.rootDir, ".git");
    if (!fs.existsSync(gitDir)) {
      try {
        fs.writeFileSync(path.join(this.rootDir, "README.md"), "# Aegis Sandbox Repo\n");
        const gitBin = process.platform === "win32" ? "git.exe" : "git";
        execFileSync(gitBin, ["init", "-b", "main"], { cwd: this.rootDir, stdio: "ignore" });
        execFileSync(gitBin, ["config", "user.name", "AegisBot"], { cwd: this.rootDir, stdio: "ignore" });
        execFileSync(gitBin, ["config", "user.email", "bot@aegis.local"], { cwd: this.rootDir, stdio: "ignore" });
        execFileSync(gitBin, ["add", "."], { cwd: this.rootDir, stdio: "ignore" });
        execFileSync(gitBin, ["commit", "-m", "Initial sandbox commit"], { cwd: this.rootDir, stdio: "ignore" });
      } catch (e) {
        // Fallback if git is not available
      }
    }
  }

  /**
   * Prevents path traversal and symlink escapes.
   * Ensures the resolved canonical path lies strictly within the target parent directory.
   */
  public resolveSafeChildPath(parentDir: string, relativeOrFileName: string): string {
    const parentCanonical = fs.realpathSync(parentDir);
    const resolvedPath = path.resolve(parentCanonical, relativeOrFileName);

    // Reject traversal if path does not start with parent directory
    if (!resolvedPath.startsWith(parentCanonical + path.sep) && resolvedPath !== parentCanonical) {
      throw new Error(`Path traversal violation: target lies outside sandbox directory: ${relativeOrFileName}`);
    }

    // Check for symlinks along existing parts of the path
    if (fs.existsSync(resolvedPath)) {
      const lstat = fs.lstatSync(resolvedPath);
      if (lstat.isSymbolicLink()) {
        throw new Error(`Symlink escape violation: symbolic links are forbidden in sandbox`);
      }
      const realResolved = fs.realpathSync(resolvedPath);
      if (!realResolved.startsWith(parentCanonical + path.sep) && realResolved !== parentCanonical) {
        throw new Error(`Symlink destination escapes sandbox perimeter`);
      }
    }

    return resolvedPath;
  }

  public async readProjectStatus(params: ReadProjectStatusParams): Promise<ToolExecutionResult> {
    const start = Date.now();
    try {
      const files = fs.readdirSync(this.rootDir);
      let branch = "unknown";
      try {
        const gitBin = process.platform === "win32" ? "git.exe" : "git";
        const { stdout } = await execFileAsync(gitBin, ["branch", "--show-current"], {
          cwd: this.rootDir,
          timeout: 2000,
        });
        branch = stdout.trim();
      } catch {
        branch = "main";
      }

      const statusObj = {
        status: "healthy",
        sandboxRoot: path.basename(this.rootDir),
        activeBranch: branch,
        fileCount: files.length,
        files: params.format === "full" ? files : files.slice(0, 10),
      };

      const outputStr = JSON.stringify(statusObj, null, 2);
      const resultHash = `0x${createHash("sha256").update(outputStr).digest("hex")}` as `0x${string}`;

      return {
        success: true,
        toolName: "read_project_status",
        output: outputStr,
        resultHash,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        toolName: "read_project_status",
        output: "",
        resultHash: `0x${"0".repeat(64)}`,
        durationMs: Date.now() - start,
        error: err?.message ?? String(err),
      };
    }
  }

  public async createSandboxBranch(params: CreateSandboxBranchParams): Promise<ToolExecutionResult> {
    const start = Date.now();
    try {
      // Validate branch name does not contain shell or git injection metacharacters
      if (params.branchName.startsWith("-")) {
        throw new Error("Invalid branch name: cannot start with a dash");
      }

      const gitBin = process.platform === "win32" ? "git.exe" : "git";
      const { stdout, stderr } = await execFileAsync(
        gitBin,
        ["checkout", "-B", params.branchName],
        {
          cwd: this.rootDir,
          timeout: 5000,
        }
      );

      const combinedOutput = (stdout + stderr).slice(0, this.maxOutputBytes);
      const resultHash = `0x${createHash("sha256").update(combinedOutput || params.branchName).digest("hex")}` as `0x${string}`;

      return {
        success: true,
        toolName: "create_sandbox_branch",
        output: combinedOutput || `Switched to branch '${params.branchName}'`,
        resultHash,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        toolName: "create_sandbox_branch",
        output: "",
        resultHash: `0x${"0".repeat(64)}`,
        durationMs: Date.now() - start,
        error: err?.message ?? String(err),
      };
    }
  }

  public async writeDemoFile(params: WriteDemoFileParams): Promise<ToolExecutionResult> {
    const start = Date.now();
    try {
      // Confine strictly inside demoDir
      const safePath = this.resolveSafeChildPath(this.demoDir, params.fileName);

      fs.writeFileSync(safePath, params.content, { encoding: "utf8", flag: "w" });

      const outputStr = `Successfully wrote ${params.content.length} bytes to ${params.fileName}`;
      const resultHash = `0x${createHash("sha256").update(params.content).digest("hex")}` as `0x${string}`;

      return {
        success: true,
        toolName: "write_demo_file",
        output: outputStr,
        resultHash,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        toolName: "write_demo_file",
        output: "",
        resultHash: `0x${"0".repeat(64)}`,
        durationMs: Date.now() - start,
        error: err?.message ?? String(err),
      };
    }
  }

  public async runTestSuite(params: RunTestSuiteParams): Promise<ToolExecutionResult> {
    const start = Date.now();
    try {
      // Deterministic sandboxed mock test execution
      const testFile = path.join(this.rootDir, "sandbox.test.js");
      if (params.target === "failing") {
        fs.writeFileSync(
          testFile,
          `console.error("FAIL: mock test failure triggered [target: failing]"); process.exit(1);`
        );
      } else if (!fs.existsSync(testFile) || fs.readFileSync(testFile, "utf8").includes("process.exit(1)")) {
        fs.writeFileSync(
          testFile,
          `console.log("PASS: sandbox unit tests [target: ${params.target ?? "all"}] (4 suites, 16 tests passed)");`
        );
      }

      const nodeBin = process.execPath;
      const { stdout, stderr } = await execFileAsync(nodeBin, [testFile], {
        cwd: this.rootDir,
        timeout: params.timeoutMs ?? 5000,
      });

      const combinedOutput = (stdout + stderr).slice(0, this.maxOutputBytes);
      const resultHash = `0x${createHash("sha256").update(combinedOutput).digest("hex")}` as `0x${string}`;

      return {
        success: true,
        toolName: "run_test_suite",
        output: combinedOutput,
        resultHash,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        toolName: "run_test_suite",
        output: "",
        resultHash: `0x${"0".repeat(64)}`,
        durationMs: Date.now() - start,
        error: err?.message ?? String(err),
      };
    }
  }
}
