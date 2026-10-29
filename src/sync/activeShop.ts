import AsyncStorage from '@react-native-async-storage/async-storage';

const ACTIVE_SHOP_KEY = 'billing.activeShop';
const DEFAULT_SHOP_KEY = 'billing.defaultShopId';

export interface ActiveShop {
  id: string;
  name: string;
}

export async function getActiveShop(): Promise<ActiveShop | null> {
  const raw = await AsyncStorage.getItem(ACTIVE_SHOP_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ActiveShop>;
    if (typeof parsed.id !== 'string' || !parsed.id) return null;
    return {
      id: parsed.id,
      name: typeof parsed.name === 'string' ? parsed.name : '',
    };
  } catch {
    return null;
  }
}

export async function getActiveShopId(): Promise<string | null> {
  return (await getActiveShop())?.id ?? null;
}

export async function getDefaultShopId(): Promise<string | null> {
  return AsyncStorage.getItem(DEFAULT_SHOP_KEY);
}

export async function setActiveShop(shop: ActiveShop | null): Promise<void> {
  if (!shop) {
    await AsyncStorage.removeItem(ACTIVE_SHOP_KEY);
    return;
  }

  // The first cloud shop keeps using the original `billingapp.db`, so an
  // existing local catalogue is preserved. Additional shops get their own
  // database file in `getDatabase()`.
  const defaultShopId = await getDefaultShopId();
  if (!defaultShopId) {
    await AsyncStorage.setItem(DEFAULT_SHOP_KEY, shop.id);
  }

  await AsyncStorage.setItem(
    ACTIVE_SHOP_KEY,
    JSON.stringify({ id: shop.id, name: shop.name })
  );
}
