import { type FastifyInstance } from "fastify";
import { AuditDatabase } from "./services/auditDb.js";
import { PolicyClient } from "./services/policyClient.js";
import { SandboxEnvironment } from "./tools/sandbox.js";
export interface GatewayServerConfig {
    policyClient: PolicyClient;
    auditDb: AuditDatabase;
    sandbox: SandboxEnvironment;
}
export declare function buildGatewayServer(config: GatewayServerConfig): FastifyInstance;
