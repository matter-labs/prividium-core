import type { z } from 'zod';
import type { sessionSchema } from '../../server/server.js';
import type { DoctorProfileSchema } from './profile.js';

export type Options = {
    rpcUrl?: string;
    userPanelUrl?: string;
    configPath?: string;
};

export type NormalizedTargets = {
    apiBaseUrl: string;
    userPanelBaseUrl?: string;
};

export type ReportStatus = 'pass' | 'warn' | 'fail' | 'skip';

export type ReportValue = {
    label: string;
    value: string;
    inline?: boolean;
};

export type ProbeOutput = {
    status?: Exclude<ReportStatus, 'fail' | 'skip'>;
    values?: ReportValue[];
    details?: string[];
};

export type ReportContext = {
    authExpiresAt: string;
    roles: string[];
    sessionType: string;
    userDisplayName: string;
    userId: string;
    walletCount: number;
};

export type ProbeResult = {
    id: string;
    label: string;
    status: ReportStatus;
    details?: string[];
    values?: ReportValue[];
    section: string;
};

export type ReportBlock =
    | {
          type: 'values';
          id: string;
          title: string;
          values: ReportValue[];
      }
    | {
          type: 'section';
          id: string;
          title: string;
          probes: ProbeResult[];
      };

export type DoctorReport = {
    status: ReportStatus;
    blocks: ReportBlock[];
};

export type AuthenticatedDoctorState = {
    token: string;
    profile: z.infer<DoctorProfileSchema>;
    session: z.infer<typeof sessionSchema>;
};

export type DoctorContext = {
    rawRpcUrl: string;
    rawUserPanelUrl?: string;
    targets?: NormalizedTargets;
    authState?: AuthenticatedDoctorState;
    reportContext?: ReportContext;
    walletAddresses: string[];
    walletApiAvailable: boolean;
    walletApiPath?: string;
    results: ProbeResult[];
    pendingToken?: string;
    pendingSession?: z.infer<typeof sessionSchema>;
    apiVersion?: string;
};

export type DoctorProbeDefinition = {
    id: string;
    label: string;
    progressMessage?: string;
    runIf?: (context: DoctorContext) => { run: true } | { run: false; reason: string };
    run?: (context: DoctorContext) => Promise<ProbeOutput | undefined> | Promise<void>;
};

export type DoctorStageDefinition = {
    id: string;
    title: string;
    getProbes: (context: DoctorContext) => DoctorProbeDefinition[];
};
