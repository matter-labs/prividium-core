import ipaddr from 'ipaddr.js';

export const MIN_IPV4_CIDR_PREFIX_LENGTH = 16;
export const MIN_IPV6_CIDR_PREFIX_LENGTH = 32;

export function isOverbroadCidr(addr: ipaddr.IPv4 | ipaddr.IPv6, prefixLength: number): boolean {
    if (addr.kind() === 'ipv4') {
        return prefixLength < MIN_IPV4_CIDR_PREFIX_LENGTH;
    }

    return prefixLength < MIN_IPV6_CIDR_PREFIX_LENGTH;
}

export function isOverbroadIpOrCidr(ipAddress: string): boolean {
    if (ipaddr.isValid(ipAddress)) return false;
    try {
        const [addr, prefixLength] = ipaddr.parseCIDR(ipAddress);
        return isOverbroadCidr(addr, prefixLength);
    } catch {
        // Unparseable entries are skipped by enforcement (isIpAllowed), so they deny — safe to report as not overbroad.
        return false;
    }
}

export function withOverbroadFlag<T extends { ipAddress: string }>(entry: T): T & { isOverbroad: boolean } {
    return { ...entry, isOverbroad: isOverbroadIpOrCidr(entry.ipAddress) };
}

export function hasOverbroadIp(entries: { ipAddress: string }[]): boolean {
    return entries.some((e) => isOverbroadIpOrCidr(e.ipAddress));
}
