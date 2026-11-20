/**
 * Платформын тохиргоо: админы Богд банкны QR зураг, дансны дугаар, нэр.
 * Зөвхөн `platform_settings`-ийг уншина; өөрчлөлт нь админ RPC-ээр
 * (`save_platform_settings`) сервер талд хийгдэнэ.
 */

import { supabase } from '@/lib/supabase';

export interface BankSettings {
  bank_name: string;
  account_number: string;
  account_name: string;
  qr_url: string;
}

export const DEFAULT_BANK_SETTINGS: BankSettings = {
  bank_name: 'Богд банк',
  account_number: '',
  account_name: '',
  qr_url: '/qr.png',
};

export async function loadBankSettings(): Promise<BankSettings> {
  const { data } = await supabase
    .from('platform_settings')
    .select('bank_name, account_number, account_name, qr_url')
    .eq('id', 1)
    .maybeSingle();
  if (!data) return DEFAULT_BANK_SETTINGS;
  const row = data as Partial<BankSettings>;
  return {
    bank_name: row.bank_name || DEFAULT_BANK_SETTINGS.bank_name,
    account_number: row.account_number ?? '',
    account_name: row.account_name ?? '',
    qr_url: row.qr_url || DEFAULT_BANK_SETTINGS.qr_url,
  };
}

export async function saveBankSettings(input: BankSettings): Promise<string> {
  const { error } = await supabase.rpc('save_platform_settings', {
    p_bank_name: input.bank_name,
    p_account_number: input.account_number,
    p_account_name: input.account_name,
    p_qr_url: input.qr_url,
  });
  if (error) throw new Error(error.message);
  return 'Хадгалагдлаа';
}

/** Гүйлгээний утга болох давтагдашгүй 6 оронтой код. */
export function generatePaymentCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
