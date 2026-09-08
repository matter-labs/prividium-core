import { note } from '@clack/prompts';
import color from 'kleur';
import type { DoctorReport, ProbeResult, ReportBlock } from '../types.js';

export function printReport(report: DoctorReport): void {
    const lines: string[] = [];
    for (const block of report.blocks) {
        appendBlock(lines, block);
    }

    note(lines.join('\n'), 'Report');
}

function entryIcon(status: ProbeResult['status']): string {
    if (status === 'pass') {
        return color.bold().green('[OK]');
    }
    if (status === 'warn') {
        return color.bold().yellow('[WARN]');
    }
    if (status === 'skip') {
        return color.bold().cyan('[SKIP]');
    }

    return color.bold().red('[FAIL]');
}

function label(text: string): string {
    return color.bold(text);
}

function value(text: string): string {
    return color.bold().white(text);
}

function formatProbeLines(probe: ProbeResult): string[] {
    const lines = [`${entryIcon(probe.status)} ${probe.label}`];
    const inlineValues = probe.values?.filter((entry) => entry.inline) ?? [];
    const inlineValue = inlineValues.length === 1 ? inlineValues[0] : undefined;
    if (inlineValue) {
        lines[0] = `${lines[0]} (${inlineValue.value})`;
    }

    for (const probeValue of probe.values?.filter((entry) => !entry.inline) ?? []) {
        lines.push(`   ${probeValue.label}: ${probeValue.value}`);
    }

    for (const detail of probe.details ?? []) {
        if (detail.trim().length > 0) {
            lines.push(`   ${detail}`);
        }
    }

    return lines;
}

function appendBlock(lines: string[], block: ReportBlock): void {
    if (block.type === 'values') {
        if (lines.length > 0) {
            lines.push('');
        }

        lines.push(label(block.title));
        for (const blockValue of block.values) {
            lines.push(`${label(`${blockValue.label}:`)} ${value(blockValue.value)}`);
        }
        return;
    }

    if (block.probes.length === 0) {
        return;
    }

    if (lines.length > 0) {
        lines.push('');
    }

    lines.push(label(block.title));
    for (const probe of block.probes) {
        lines.push(...formatProbeLines(probe));
    }
}
