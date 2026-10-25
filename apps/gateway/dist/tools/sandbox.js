// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
const execFileAsync = promisify(execFile);
export class SandboxEnvironment {
    rootDir;
    demoDir;
    maxOutputBytes = 50 * 1024; // 50 KB ceiling
    constructor(baseDir) {
        this.rootDir = path.resolve(baseDir ?? path.join(process.cwd(), "scratch", "sandbox"));
        this.demoDir = path.join(this.rootDir, "demo");
        this.init();
    }
    init() {
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
                // Run git init directly without shell
                const gitBin = process.platform === "win32" ? "git.exe" : "git";
                execFile(gitBin, ["init", "-b", "main"], { cwd: this.rootDir }, (err) => {
                    if (!err) {
                        execFile(gitBin, ["config", "user.name", "AegisBot"], { cwd: this.rootDir }, () => {
                            execFile(gitBin, ["config", "user.email", "bot@aegis.local"], { cwd: this.rootDir }, () => {
                                execFile(gitBin, ["add", "."], { cwd: this.rootDir }, () => {
                                    execFile(gitBin, ["commit", "-m", "Initial sandbox commit"], { cwd: this.rootDir }, () => { });
                                });
                            });
                        });
                    }
                });
            }
            catch (e) {
                // Fallback if git is not available or directory exists
            }
        }
    }
    /**
     * Prevents path traversal and symlink escapes.
     * Ensures the resolved canonical path lies strictly within the target parent directory.
     */
    resolveSafeChildPath(parentDir, relativeOrFileName) {
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
    async readProjectStatus(params) {
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
            }
            catch {
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
            const resultHash = `0x${createHash("sha256").update(outputStr).digest("hex")}`;
            return {
                success: true,
                toolName: "read_project_status",
                output: outputStr,
                resultHash,
                durationMs: Date.now() - start,
            };
        }
        catch (err) {
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
    async createSandboxBranch(params) {
        const start = Date.now();
        try {
            // Validate branch name does not contain shell or git injection metacharacters
            if (params.branchName.startsWith("-")) {
                throw new Error("Invalid branch name: cannot start with a dash");
            }
            const gitBin = process.platform === "win32" ? "git.exe" : "git";
            const { stdout, stderr } = await execFileAsync(gitBin, ["checkout", "-B", params.branchName], {
                cwd: this.rootDir,
                timeout: 5000,
            });
            const combinedOutput = (stdout + stderr).slice(0, this.maxOutputBytes);
            const resultHash = `0x${createHash("sha256").update(combinedOutput || params.branchName).digest("hex")}`;
            return {
                success: true,
                toolName: "create_sandbox_branch",
                output: combinedOutput || `Switched to branch '${params.branchName}'`,
                resultHash,
                durationMs: Date.now() - start,
            };
        }
        catch (err) {
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
    async writeDemoFile(params) {
        const start = Date.now();
        try {
            // Confine strictly inside demoDir
            const safePath = this.resolveSafeChildPath(this.demoDir, params.fileName);
            fs.writeFileSync(safePath, params.content, { encoding: "utf8", flag: "w" });
            const outputStr = `Successfully wrote ${params.content.length} bytes to ${params.fileName}`;
            const resultHash = `0x${createHash("sha256").update(params.content).digest("hex")}`;
            return {
                success: true,
                toolName: "write_demo_file",
                output: outputStr,
                resultHash,
                durationMs: Date.now() - start,
            };
        }
        catch (err) {
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
    async runTestSuite(params) {
        const start = Date.now();
        try {
            // Deterministic sandboxed mock test execution
            const testFile = path.join(this.rootDir, "sandbox.test.js");
            if (!fs.existsSync(testFile)) {
                fs.writeFileSync(testFile, `console.log("PASS: sandbox unit tests [target: ${params.target}] (4 suites, 16 tests passed)");`);
            }
            const nodeBin = process.execPath;
            const { stdout, stderr } = await execFileAsync(nodeBin, [testFile], {
                cwd: this.rootDir,
                timeout: params.timeoutMs ?? 5000,
            });
            const combinedOutput = (stdout + stderr).slice(0, this.maxOutputBytes);
            const resultHash = `0x${createHash("sha256").update(combinedOutput).digest("hex")}`;
            return {
                success: true,
                toolName: "run_test_suite",
                output: combinedOutput,
                resultHash,
                durationMs: Date.now() - start,
            };
        }
        catch (err) {
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
