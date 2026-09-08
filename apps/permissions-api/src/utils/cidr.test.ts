import ipaddr from 'ipaddr.js';
import { describe, expect, it } from 'vitest';
import { isOverbroadCidr, isOverbroadIpOrCidr } from './cidr';

describe('isOverbroadCidr', () => {
    it('flags 0.0.0.0/0 as overbroad', () => {
        const [addr, prefixLength] = ipaddr.parseCIDR('0.0.0.0/0');
        expect(isOverbroadCidr(addr, prefixLength)).toBe(true);
    });

    it('flags IPv4 CIDRs with prefix shorter than /16 as overbroad', () => {
        const [addr, prefixLength] = ipaddr.parseCIDR('10.0.0.0/8');
        expect(isOverbroadCidr(addr, prefixLength)).toBe(true);
    });

    it('does not flag /16 and tighter IPv4 CIDRs', () => {
        const [addr16, prefix16] = ipaddr.parseCIDR('10.42.0.0/16');
        const [addr24, prefix24] = ipaddr.parseCIDR('10.42.1.0/24');
        expect(isOverbroadCidr(addr16, prefix16)).toBe(false);
        expect(isOverbroadCidr(addr24, prefix24)).toBe(false);
    });

    it('flags IPv6 CIDRs with prefix shorter than /32 as overbroad', () => {
        const [addrAny, prefixAny] = ipaddr.parseCIDR('::/0');
        const [addr24, prefix24] = ipaddr.parseCIDR('2001:db8::/24');
        expect(isOverbroadCidr(addrAny, prefixAny)).toBe(true);
        expect(isOverbroadCidr(addr24, prefix24)).toBe(true);
    });

    it('does not flag /32 and tighter IPv6 CIDRs', () => {
        const [addr32, prefix32] = ipaddr.parseCIDR('2001:db8::/32');
        const [addr48, prefix48] = ipaddr.parseCIDR('2001:db8::/48');
        expect(isOverbroadCidr(addr32, prefix32)).toBe(false);
        expect(isOverbroadCidr(addr48, prefix48)).toBe(false);
    });
});

describe('isOverbroadIpOrCidr', () => {
    it('flags 0.0.0.0/0 as overbroad', () => {
        expect(isOverbroadIpOrCidr('0.0.0.0/0')).toBe(true);
    });

    it('flags IPv4 CIDRs with prefix shorter than /16 as overbroad', () => {
        expect(isOverbroadIpOrCidr('10.0.0.0/8')).toBe(true);
    });

    it('does not flag /16 and tighter IPv4 CIDRs', () => {
        expect(isOverbroadIpOrCidr('10.42.0.0/16')).toBe(false);
        expect(isOverbroadIpOrCidr('10.42.1.0/24')).toBe(false);
    });

    it('flags IPv6 CIDRs with prefix shorter than /32 as overbroad', () => {
        expect(isOverbroadIpOrCidr('::/0')).toBe(true);
        expect(isOverbroadIpOrCidr('2001:db8::/24')).toBe(true);
    });

    it('does not flag /32 and tighter IPv6 CIDRs', () => {
        expect(isOverbroadIpOrCidr('2001:db8::/32')).toBe(false);
        expect(isOverbroadIpOrCidr('2001:db8::/48')).toBe(false);
    });

    it('does not flag plain IP addresses', () => {
        expect(isOverbroadIpOrCidr('192.168.1.5')).toBe(false);
        expect(isOverbroadIpOrCidr('::ffff:192.168.1.1')).toBe(false);
    });

    it('does not flag unparseable strings', () => {
        expect(isOverbroadIpOrCidr('garbage')).toBe(false);
        expect(isOverbroadIpOrCidr('weird/0')).toBe(false);
        expect(isOverbroadIpOrCidr('10.0.0.0/abc')).toBe(false);
    });
});
