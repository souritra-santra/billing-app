/**
 * Lazily loads the native Bluetooth thermal-printer driver.
 *
 * The driver requires a custom development build (it is not available in Expo
 * Go / on web).
 *
 * IMPORTANT: the package's own JS calls
 *   `TurboModuleRegistry.getEnforcing('ThermalPrinterDriver')`
 * at module top level, which throws an Invariant Violation when the native
 * module is missing. That exception cannot be reliably caught by wrapping
 * `require()` in a try/catch (Metro propagates it), so we first probe for the
 * native module with the non-throwing `TurboModuleRegistry.get(...)` and only
 * `require` the JS package when the native binary actually has it.
 */
import { Platform, TurboModuleRegistry } from 'react-native';
import type {
    Node,
    PrinterOptions,
    ScanResult,
    TestResult,
    PrintResult,
} from 'react-native-thermal-printer-driver';

// Metro provides `require` at runtime; declare it so TypeScript is happy.
declare const require: (moduleName: string) => unknown;

export interface ThermalPrinterApi {
    scan(): Promise<ScanResult>;
    connect(address: string, options?: { timeout?: number }): Promise<void>;
    disconnect(address?: string): Promise<void>;
    isConnected(address: string): Promise<boolean>;
    testConnection(address: string): Promise<TestResult>;
    print(address: string, nodes: Node[], options?: PrinterOptions): Promise<PrintResult>;
}

interface ThermalDriverModule {
    default: ThermalPrinterApi;
}

let cached: ThermalDriverModule | null | undefined;

function isNativeModuleRegistered(): boolean {
    if (Platform.OS === 'web') return false;
    try {
        return TurboModuleRegistry.get('ThermalPrinterDriver') != null;
    } catch {
        return false;
    }
}

export function getThermalDriver(): ThermalDriverModule | null {
    if (cached !== undefined) return cached;
    if (!isNativeModuleRegistered()) {
        // Native module is missing (Expo Go / web / plain build). Do NOT touch
        // the package's JS, since evaluating it throws an uncaught
        // Invariant Violation from TurboModuleRegistry.getEnforcing.
        cached = null;
        return cached;
    }
    try {
        cached = require('react-native-thermal-printer-driver') as ThermalDriverModule;
    } catch {
        cached = null;
    }
    return cached;
}

/**
 * True when the native driver is present. This is only the case in a custom
 * development/EAS build that includes `react-native-thermal-printer-driver`.
 */
export function isThermalPrintingSupported(): boolean {
    return getThermalDriver() != null;
}
