import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Gift,
  MailOpen,
  Users,
  ArrowRight,
  MonitorSmartphone,
  ShieldCheck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Money } from '@/components/Shell';
import { FEE_RATE } from '@/lib/utils';

type Mode = 'lucky_draw' | 'group_pool' | 'gift_card';

const MODES: {
  id: Mode;
  icon: React.ReactNode;
  label: string;
  desc: string;
  gradient: string;
}[] = [
  {
    id: 'lucky_draw',
    icon: <MailOpen className="w-8 h-8 text-white" />,
    label: 'Азын дугтуй',
    desc: 'Нийт дүнгээ оруулаад хүний тоог зааж өгөөд оролцогчид дугтуй задлан санамсаргүй мөнгөө хүртэнэ.',
    gradient: 'from-red-500 to-amber-500',
  },
  {
    id: 'group_pool',
    icon: <Users className="w-8 h-8 text-white" />,
    label: 'Хамтын бэлэг',
    desc: 'Төрсөн өдрийн, хуримын эсвэл салхидалтын зардлыг нэг дор цуглуул. Хэн хэдэн төгрөг өгсөн нь ил харагдана.',
    gradient: 'from-emerald-500 to-teal-600',
  },
  {
    id: 'gift_card',
    icon: <Gift className="w-8 h-8 text-white" />,
    label: 'Мэндчилгээт бэлэг',
    desc: 'Ганц хүнд зураг, мэндчилгээний үгтэй цахим дугтуйгаар мөнгө бэлэглэ.',
    gradient: 'from-sky-500 to-indigo-600',
  },
];

const STEPS = [
  {
    title: '1. Өрөө үүсгэх',
    desc: 'Үйл явдлын нэр, дүн, хүний тоогоо оруулаад Богд банкны QR-аар шилжүүлнэ.',
  },
  {
    title: '2. Линк хуваалцах',
    desc: 'Үүссэн линкээ найзууддаа илгээнэ. Бүртгэлтэй хэрэглэгчид шууд нэгдэнэ.',
  },
  {
    title: '3. Бэлгээ задлах',
    desc: 'Оролцогчид дугтуйгаа задлан мөнгөө данс руугаа шууд татна.',
  },
];

export function Landing({ onCreate }: { onCreate: (mode?: Mode) => void }) {
  const [stats, setStats] = useState({ giftCount: 0, giftTotal: 0 });

  useEffect(() => {
    supabase
      .from('envelopes')
      .select('amount, claimed')
      .then(({ data }) => {
        if (data) {
          const claimed = data.filter((e) => e.claimed);
          setStats({
            giftCount: claimed.length,
            giftTotal: claimed.reduce((s, e) => s + e.amount, 0),
          });
        }
      });
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50 via-amber-50 to-white">
      {/* Header rendered by App */}

      {/* hero */}
      <section className="mx-auto max-w-5xl px-4 pt-16 pb-12 text-center">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-neutral-900 leading-tight">
            Бэлгээ цахимаар өг,
            <br />
            <span className="bg-gradient-to-r from-red-600 to-amber-500 bg-clip-text text-transparent">
              баяр хөөр түгээ
            </span>
          </h1>
          <p className="mt-5 text-neutral-600 max-w-xl mx-auto">
            Азын дугтуй, хамтын цугларалт, мэндчилгээт бэлэг — бүгд нэг дор. Линкээ
            хуваалцаад хамтдаа бэлгээ солилц.
          </p>
          <button
            onClick={() => onCreate()}
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-neutral-900 text-white px-7 py-3.5 font-semibold hover:bg-neutral-700 hover:scale-[1.03] transition-all shadow-lg"
          >
            Өрөө үүсгэх <ArrowRight className="w-4 h-4" />
          </button>
        </motion.div>
      </section>

      {/* mode cards */}
      <section className="mx-auto max-w-5xl px-4 py-8">
        <h2 className="text-2xl font-bold text-center text-neutral-900">
          Бэлгийн төрлөө сонгоно уу
        </h2>
        <div className="mt-8 grid sm:grid-cols-3 gap-5">
          {MODES.map((m, i) => (
            <motion.button
              key={m.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              whileHover={{ y: -6 }}
              onClick={() => onCreate(m.id)}
              className="text-left rounded-3xl bg-white border border-neutral-200 shadow-sm hover:shadow-xl transition-shadow overflow-hidden"
            >
              <div className={`p-6 bg-gradient-to-br ${m.gradient}`}>
                <motion.div
                  animate={{ rotate: [-3, 3, -3] }}
                  transition={{ repeat: Infinity, duration: 3 + i }}
                >
                  {m.icon}
                </motion.div>
              </div>
              <div className="p-6">
                <h3 className="font-bold text-lg text-neutral-900">{m.label}</h3>
                <p className="mt-2 text-sm text-neutral-500 leading-relaxed">{m.desc}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-red-600">
                  Үүсгэх <ArrowRight className="w-4 h-4" />
                </span>
              </div>
            </motion.button>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section className="mx-auto max-w-5xl px-4 py-10">
        <h2 className="text-2xl font-bold text-center text-neutral-900">Хэрхэн ажилладаг вэ?</h2>
        <div className="mt-8 grid sm:grid-cols-3 gap-5">
          {STEPS.map((h, i) => (
            <motion.div
              key={h.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="relative rounded-3xl bg-white border border-neutral-200 p-6 pt-8"
            >
              <span className="absolute -top-4 left-6 w-9 h-9 rounded-full bg-gradient-to-br from-red-500 to-amber-500 text-white flex items-center justify-center font-bold shadow-md">
                {i + 1}
              </span>
              <h3 className="font-semibold text-neutral-900">{h.title}</h3>
              <p className="mt-1.5 text-sm text-neutral-500 leading-relaxed">{h.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* stats */}
      <section className="mx-auto max-w-5xl px-4 py-10 grid md:grid-cols-2 gap-6">
        <div className="rounded-3xl bg-gradient-to-br from-red-500 to-amber-500 text-white p-6 flex flex-col justify-center">
          <h3 className="font-semibold">Нийт тараагдсан бэлэг</h3>
          <div className="mt-4 flex items-end gap-8">
            <div>
              <p className="text-sm opacity-80">Дугтуй задалсан</p>
              <p className="text-3xl font-extrabold">{stats.giftCount}</p>
            </div>
            <div>
              <p className="text-sm opacity-80">Нийт дүн</p>
              <Money amount={stats.giftTotal} className="text-3xl font-extrabold" />
            </div>
          </div>
          <p className="mt-5 text-xs opacity-80 leading-relaxed">
            Үйлчилгээний шимтгэл {(FEE_RATE * 100).toFixed(0)}% — зөвхөн үйлчилгээний зардалд.
          </p>
        </div>
      </section>

      {/* trust */}
      <section className="mx-auto max-w-5xl px-4 py-10">
        <div className="grid sm:grid-cols-2 gap-5">
          <div className="rounded-3xl bg-neutral-900 text-white p-7">
            <ShieldCheck className="w-8 h-8 text-emerald-400" />
            <h3 className="mt-3 font-bold text-lg">Аюулгүй ба ил тод</h3>
            <p className="mt-2 text-sm text-neutral-300 leading-relaxed">
              Нэг хүн зөвхөн нэг л дугтуй задлана. Мөнгө зөвхөн албан ёсны банкуудын
              дамжуулалтаар шилжинэ.
            </p>
          </div>
          <div className="rounded-3xl bg-white border border-neutral-200 p-7">
            <MonitorSmartphone className="w-8 h-8 text-red-500" />
            <h3 className="mt-3 font-bold text-lg">Гар утсанд тохиромжтой</h3>
            <p className="mt-2 text-sm text-neutral-500 leading-relaxed">
              Хожсон болон цугларсан мөнгө таны хэтэвчинд шууд орно.
            </p>
          </div>
        </div>
      </section>

      <footer className="py-8 text-center text-xs text-neutral-400">
        © {new Date().getFullYear()} Бэлэг — Цахим бэлэг илгээх платформ
      </footer>
    </div>
  );
}
