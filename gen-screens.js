'use strict';
/*
 * gen-screens.js — গ্রাহকের নয়টা স্ক্রিন
 *
 * ⚠️ স্ক্রিনের ধরন ঠিক হয় নাম দেখে, শ্রেণি দেখে নয়।
 * ১০০০টা অ্যাপে ২৮৮ রকম স্ক্রিনের নাম আছে, আর নামই সবচেয়ে নির্ভরযোগ্যভাবে
 * বলে দেয় ওখানে কী থাকা উচিত। "Wallet home"-এ টাকার অঙ্ক, "Chat room"-এ
 * কথার বুদবুদ, "Scan QR"-এ ক্যামেরা।
 *
 * ⚠️ প্রতিটা স্ক্রিনে চারটে অবস্থা থাকে, ব্যতিক্রম নেই:
 *     loading → error → empty → data
 * বেশিরভাগ শেখানো প্রকল্পে শুধু শেষেরটা থাকে। কিন্তু নতুন ব্যবহারকারী
 * প্রথমেই খালি পর্দা দেখে, আর দুর্বল নেটে ভুলের পর্দা। ওই দুটোই ঠিক করে
 * সে থাকবে না চলে যাবে।
 */

/* ⚠️ গোটা শব্দ মেলানো হয়, ভেতরের টুকরো নয় — "transaction hi-story"-তে
   "story" মিলে গিয়ে ক্যামেরার পর্দা বসে যাচ্ছিল। শুধু বহুবচনটুকু ছাড়
   দেওয়া হচ্ছে, নাহলে "Settings" আর "Setting"-এ আলাদা ফল আসে। */
const has = (label, ...needles) => {
  const words = String(label).toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean);
  return needles.some(n => {
    const t = n.toLowerCase();
    if (t.includes(' ')) return String(label).toLowerCase().includes(t);
    return words.some(w => w === t || w === t + 's' || w + 's' === t);
  });
};

/* ⚠️ App.js-ও ঠিক এই নিয়মেই নাম বানায়। দুই জায়গায় দুই নিয়ম হলে
   ফাইল তৈরি হয় এক নামে আর import খোঁজে অন্য নামে — অ্যাপ চালু হওয়ার
   মুহূর্তে ভেঙে পড়ে। "&" কে "And" করা হয়, ফেলে দেওয়া হয় না, নাহলে
   "Profile & Settings" থেকে "ProfileSettings" হয়ে অর্থ হারায়। */
function comp(label) {
  return String(label)
    .replace(/&amp;|&/g, 'And')
    .replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('')
    // ⚠️ JavaScript-এ নাম সংখ্যা দিয়ে শুরু হতে পারে না। "10-min slot"
    // থেকে "10MinSlot" হলে ফাইলটা লেখা হতো কিন্তু চালাতে গিয়ে ভাঙত।
    // ১০০০টা অ্যাপে এমন একটাই আছে, আর সেটাই যথেষ্ট।
    .replace(/^([0-9])/, 'Screen$1') + 'Screen';
}

/* কোন স্ক্রিন কোন ছাঁচে — নাম দেখে */
function kindOf(label) {
  // ক্রমটাই সব — উপরেরটা আগে জেতে। তাই সবচেয়ে নির্দিষ্টগুলো উপরে।
  if (has(label, 'scan', 'qr', 'camera', 'capture')) return 'scan';
  if (has(label, 'checkout', 'payment', 'pay', 'billing', 'invoice')) return 'pay';
  if (has(label, 'chat room', 'conversation', 'message thread', 'dm')) return 'chat';
  if (has(label, 'map', 'track', 'ride', 'trip', 'route', 'nearby', 'navigation')) return 'map';
  if (has(label, 'wallet', 'balance', 'earning', 'summary', 'dashboard', 'stat', 'analytic', 'report')) return 'summary';
  if (has(label, 'setting', 'preference', 'privacy', 'about', 'help', 'support')) return 'settings';
  if (has(label, 'profile', 'account')) return 'settings';
  if (has(label, 'login', 'signin', 'signup', 'register', 'otp', 'pin', 'password', 'verify', 'kyc')) return 'form';
  if (has(label, 'add', 'send', 'request', 'create', 'compose', 'new', 'upload', 'edit')) return 'form';
  if (has(label, 'detail', 'viewer', 'lesson', 'article', 'recipe', 'player')) return 'detail';
  return 'list';
}

/* ---------------------------------------------------------------- */
/* সব স্ক্রিনে এই মাথাটা এক — তাই শেখানোর সময় একবার বুঝলেই যথেষ্ট */
function head(a, label, extraImports) {
  return `// ${comp(label)} — ${label}
//
// Every screen in ${a.name} follows the same four states:
//   loading, error, empty, data.
// Learn it once here and the other eight screens hold no surprises.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { api } from '../api';
import { theme } from '../theme';
import { useT } from '../i18n';
import { useAuth } from '../auth';
import { Button, Input, Card, Row, Badge, Loader, Empty, ErrorView, AdSlot } from '../ui';
${extraImports || ''}`;
}

/* ---------------------------------------------------------------- list */
function listScreen(a, label, path) {
  return `${head(a, label)}
export default function ${comp(label)}({ navigation }) {
  const { t } = useT();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [refreshing, setRef]  = useState(false);
  const [page, setPage]       = useState(1);
  const [done, setDone]       = useState(false);

  const load = useCallback(async (p = 1, replace = true) => {
    try {
      setError(null);
      // Ask for one page at a time. Loading everything works fine with
      // twenty rows and falls over at twenty thousand. Build it right now,
      // while the list is small and the bug is invisible.
      const r = await api.get('${path}?page=' + p + '&limit=20');
      const rows = r.items || [];
      setItems(prev => (replace ? rows : prev.concat(rows)));
      setDone(rows.length < 20);
      setPage(p);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
      setRef(false);
    }
  }, []);

  useEffect(() => { load(1, true); }, [load]);

  if (loading) return <Loader label={t('loading')} />;
  if (error)   return <ErrorView error={error} onRetry={() => { setLoading(true); load(1, true); }} />;

  if (!items.length) {
    return (
      <Empty
        title={t('nothingHere')}
        hint="When something arrives it will show up here."
        actionTitle={t('retry')}
        onAction={() => { setLoading(true); load(1, true); }}
      />
    );
  }

  return (
    <View style={s.wrap}>
      <AdSlot where="onList" />
      <FlatList
        data={items}
        keyExtractor={it => String(it.id)}
        refreshControl={
          <RefreshControl refreshing={refreshing}
            onRefresh={() => { setRef(true); load(1, true); }} />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (!done) load(page + 1, false); }}
        renderItem={({ item }) => (
          <Row
            title={item.title}
            sub={item.subtitle}
            right={item.meta}
            onPress={() => navigation.navigate('Detail', { id: item.id })}
          />
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
});
`;
}

/* ---------------------------------------------------------------- form */
function formScreen(a, label, path) {
  return `${head(a, label, "import { checkForm } from '../helpers';")}
export default function ${comp(label)}({ navigation }) {
  const { t } = useT();
  const [form, setForm]   = useState({ title: '', note: '' });
  const [errors, setErr]  = useState({});
  const [busy, setBusy]   = useState(false);
  const [failed, setFail] = useState(null);

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    // Clear that field's error the moment they start fixing it. Leaving
    // red text under a box someone is actively correcting feels like nagging.
    if (errors[k]) setErr(e => ({ ...e, [k]: undefined }));
  };

  async function submit() {
    // Check here so the answer is instant. The server checks again,
    // because anything sent from a phone can be faked. Both, always.
    const { errors: found, ok } = checkForm({
      title: { value: form.title, required: true, min: 2 },
    });
    setErr(found);
    if (!ok) return;

    setBusy(true);
    setFail(null);
    try {
      await api.post('${path}', form);
      navigation.goBack();
    } catch (e) {
      setFail(e);
    } finally {
      // finally, not inside try. If it throws and busy stays true, the
      // button is dead forever and the user has to restart the app.
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.wrap} keyboardShouldPersistTaps="handled">
      <Card>
        <Input label="${label}" value={form.title}
               onChangeText={v => set('title', v)} error={errors.title} />
        <Input label="Notes" value={form.note} multiline
               onChangeText={v => set('note', v)} hint="Optional" />
        {failed ? <Text style={s.err}>{failed.message}</Text> : null}
        <Button title={t('save')} onPress={submit} busy={busy} />
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  err:  { color: theme.color.danger, marginBottom: theme.space.md },
});
`;
}

/* ---------------------------------------------------------------- detail */
function detailScreen(a, label, path) {
  return `${head(a, label)}
export default function ${comp(label)}({ route, navigation }) {
  const { t } = useT();
  const id = route.params && route.params.id;
  const [item, setItem]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      // The server decides whether this record is yours. Never trust an
      // id that arrived from a phone. Someone will change it by hand.
      setItem(await api.get('${path}/' + id));
    } catch (e) { setError(e); } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loader label={t('loading')} />;
  if (error)   return <ErrorView error={error} onRetry={() => { setLoading(true); load(); }} />;
  if (!item)   return <Empty title={t('nothingHere')} />;

  return (
    <ScrollView style={s.wrap}>
      <Card>
        <Text style={s.title}>{item.title}</Text>
        {item.status ? <View style={s.badge}><Badge text={item.status} tone="ok" /></View> : null}
        <Text style={s.body}>{item.description}</Text>
      </Card>
      <AdSlot where="onDetail" />
      <Button title={t('continue')} onPress={() => navigation.navigate('Checkout', { id })} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap:  { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  title: { fontSize: theme.font.hero, fontWeight: '800', color: theme.color.text },
  badge: { flexDirection: 'row', marginTop: theme.space.sm },
  body:  { fontSize: theme.font.body, color: theme.color.muted, marginTop: theme.space.md, lineHeight: 22 },
});
`;
}



/* ---------------------------------------------------------------- pay */
function payScreen(a, label, path) {
  return `${head(a, label, "import { money, splitPayment } from '../helpers';")}
export default function ${comp(label)}({ route, navigation }) {
  const { t } = useT();
  const [order, setOrder] = useState(null);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('${path}/' + (route.params && route.params.id))
      .then(setOrder).catch(setError);
  }, [route.params]);

  async function pay() {
    if (busy) return;              // a second tap here charges twice
    setBusy(true); setError(null);
    try {
      // The server calculates the real amount. Never send a price the
      // phone worked out; someone will edit it before it leaves.
      const r = await api.post('/payments/start', { orderId: order.id });
      navigation.replace('PaymentResult', { ref: r.reference });
    } catch (e) { setError(e); setBusy(false); }
  }

  if (!order && !error) return <Loader label={t('loading')} />;
  if (error && !order)  return <ErrorView error={error} onRetry={() => setError(null)} />;

  const split = splitPayment(order.totalMinor);
  return (
    <ScrollView style={s.wrap}>
      <Card>
        <View style={s.line}><Text style={s.k}>Item</Text><Text style={s.v}>{money(order.itemMinor)}</Text></View>
        <View style={s.line}><Text style={s.k}>Fees</Text><Text style={s.v}>{money(order.feeMinor)}</Text></View>
        <View style={s.line}><Text style={s.kb}>{t('total')}</Text><Text style={s.vb}>{money(split.total)}</Text></View>
      </Card>
      <Card>
        <Text style={s.note}>
          Provider receives {money(split.provider)} · platform fee {money(split.platform)}
        </Text>
      </Card>
      {error ? <Text style={s.err}>{error.message}</Text> : null}
      <Button title={t('pay')} onPress={pay} busy={busy} />
      {/* No AdSlot here, deliberately. An advert beside a Pay button costs
          more in abandoned payments than it earns in a year. */}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  k:  { color: theme.color.muted, fontSize: theme.font.body },
  v:  { color: theme.color.text,  fontSize: theme.font.body },
  kb: { color: theme.color.text,  fontSize: theme.font.title, fontWeight: '800' },
  vb: { color: theme.color.text,  fontSize: theme.font.title, fontWeight: '800' },
  note: { color: theme.color.muted, fontSize: theme.font.small, lineHeight: 20 },
  err:  { color: theme.color.danger, marginBottom: theme.space.md },
});
`;
}

/* ---------------------------------------------------------------- chat */
function chatScreen(a, label, path) {
  return `${head(a, label)}
export default function ${comp(label)}({ route }) {
  const { t } = useT();
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const id = route.params && route.params.id;

  useEffect(() => {
    let alive = true;
    const tick = () => api.get('${path}/' + id + '/messages')
      .then(r => { if (alive) setMsgs(r.items || []); })
      .catch(e => { if (alive) setError(e); });
    tick();
    // Polling, not sockets. Sockets are better and much harder to get
    // right. Ship this, get users, then switch. A working poll beats a
    // broken socket every single time.
    const timer = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [id]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText('');
    // Show it straight away, marked as sending. On a slow connection the
    // user must see their own words, or they type them a second time.
    const temp = { id: 'tmp' + Date.now(), body, mine: true, pending: true };
    setMsgs(m => m.concat(temp));
    try {
      await api.post('${path}/' + id + '/messages', { body });
    } catch (e) {
      setMsgs(m => m.map(x => (x.id === temp.id ? { ...x, failed: true, pending: false } : x)));
    }
  }

  if (error && !msgs.length) return <ErrorView error={error} />;

  return (
    <View style={s.wrap}>
      <FlatList
        data={msgs}
        inverted
        keyExtractor={m => String(m.id)}
        ListEmptyComponent={<Empty title={t('nothingHere')} hint="Say hello." />}
        renderItem={({ item }) => (
          <View style={[s.b, item.mine ? s.out : s.in]}>
            <Text style={item.mine ? s.tOut : s.tIn}>{item.body}</Text>
            {item.pending ? <Text style={s.meta}>sending…</Text> : null}
            {item.failed ? <Text style={s.fail}>not sent · tap to retry</Text> : null}
          </View>
        )}
      />
      <View style={s.bar}>
        <View style={{ flex: 1 }}>
          <Input value={text} onChangeText={setText} placeholder="Message" />
        </View>
        <Button title="Send" onPress={send} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.sm },
  b:   { maxWidth: '80%', padding: 10, borderRadius: theme.radius.md, marginVertical: 4 },
  in:  { alignSelf: 'flex-start', backgroundColor: theme.color.surface },
  out: { alignSelf: 'flex-end',   backgroundColor: theme.color.primary },
  tIn:  { color: theme.color.text },
  tOut: { color: theme.color.onPrimary },
  meta: { color: theme.color.onPrimary, fontSize: 11, marginTop: 2, opacity: 0.8 },
  fail: { color: theme.color.danger, fontSize: 11, marginTop: 2 },
  bar: { flexDirection: 'row', alignItems: 'flex-start' },
});
`;
}

/* ---------------------------------------------------------------- summary */
function summaryScreen(a, label, path) {
  return `${head(a, label, "import { money } from '../helpers';")}
export default function ${comp(label)}({ navigation }) {
  const { t } = useT();
  const [data, setData]      = useState(null);
  const [error, setError]    = useState(null);
  const [refreshing, setRef] = useState(false);

  const load = useCallback(async () => {
    try { setError(null); setData(await api.get('${path}')); }
    catch (e) { setError(e); } finally { setRef(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data && !error) return <Loader label={t('loading')} />;
  if (error && !data)  return <ErrorView error={error} onRetry={load} />;

  return (
    <ScrollView
      style={s.wrap}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRef(true); load(); }} />}
    >
      <Card>
        <Text style={s.k}>{t('total')}</Text>
        <Text style={s.big}>{money(data.balanceMinor)}</Text>
        {data.pendingMinor ? <Text style={s.k}>{t('pending')} {money(data.pendingMinor)}</Text> : null}
      </Card>
      <AdSlot where="onHome" />
      {(data.recent || []).length
        ? (data.recent || []).map(r => (
            <Row key={r.id} title={r.title} sub={r.when} right={money(r.amountMinor)}
                 onPress={() => navigation.navigate('Detail', { id: r.id })} />
          ))
        : <Empty title={t('nothingHere')} hint="Your activity will appear here." />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  k:   { color: theme.color.muted, fontSize: theme.font.small },
  big: { color: theme.color.text, fontSize: 34, fontWeight: '800', marginVertical: 4 },
});
`;
}

/* ---------------------------------------------------------------- map */
function mapScreen(a, label, path) {
  return `${head(a, label, "import { KEYS } from '../config';")}
export default function ${comp(label)}({ navigation }) {
  const { t } = useT();
  const [options, setOptions] = useState([]);
  const [picked, setPicked]   = useState(null);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('${path}').then(r => setOptions(r.items || []))
      .catch(setError).finally(() => setLoading(false));
  }, []);

  // A map needs a key from your map provider. Until it is filled in,
  // show a plain panel instead of a broken grey box. See config.js, KEYS.maps.
  const mapReady = !!KEYS.maps;

  if (loading) return <Loader label={t('loading')} />;
  if (error)   return <ErrorView error={error} onRetry={() => setError(null)} />;

  return (
    <View style={s.wrap}>
      <View style={s.map}>
        <Text style={s.mapText}>
          {mapReady ? 'Map' : 'Add your map key in config.js to show the map here'}
        </Text>
      </View>
      {options.length
        ? options.map(o => (
            <Row key={o.id} title={o.title} sub={o.eta} right={o.price}
                 onPress={() => setPicked(o.id)} />
          ))
        : <Empty title={t('nothingHere')} hint="Nothing available nearby right now." />}
      <Button title={t('continue')} disabled={!picked}
              onPress={() => navigation.navigate('Checkout', { id: picked })} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  map:  { height: 200, borderRadius: theme.radius.md, backgroundColor: theme.color.surface,
          alignItems: 'center', justifyContent: 'center', marginBottom: theme.space.md },
  mapText: { color: theme.color.muted, textAlign: 'center', paddingHorizontal: 20 },
});
`;
}

/* ---------------------------------------------------------------- scan */
function scanScreen(a, label, path) {
  return `${head(a, label)}
export default function ${comp(label)}({ navigation }) {
  const { t } = useT();
  const [manual, setManual] = useState('');
  const [error, setError]   = useState(null);

  // Camera permission is refused far more often than people expect, and a
  // scanner with no fallback is a dead end. Always let them type it in.
  return (
    <View style={s.wrap}>
      <View style={s.frame}><Text style={s.hint}>Point the camera at the code</Text></View>
      <Text style={s.or}>or enter it by hand</Text>
      <Input value={manual} onChangeText={setManual} placeholder="Code" autoCapitalize="characters" />
      {error ? <Text style={s.err}>{error.message}</Text> : null}
      <Button
        title={t('continue')}
        disabled={!manual.trim()}
        onPress={() => api.post('${path}', { code: manual.trim() })
          .then(r => navigation.navigate('Detail', { id: r.id }))
          .catch(setError)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap:  { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  frame: { height: 240, borderRadius: theme.radius.md, borderWidth: 2, borderStyle: 'dashed',
           borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center',
           marginBottom: theme.space.md },
  hint: { color: theme.color.muted },
  or:   { color: theme.color.muted, textAlign: 'center', marginBottom: theme.space.sm },
  err:  { color: theme.color.danger, marginBottom: theme.space.md },
});
`;
}

/* ---------------------------------------------------------------- settings */
function settingsScreen(a, label, path) {
  return `${head(a, label, "import { LANGUAGES } from '../i18n';")}
export default function ${comp(label)}({ navigation }) {
  const { t, lang, setLang } = useT();
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <ScrollView style={s.wrap}>
      <Card>
        <Text style={s.name}>{user ? user.name : ''}</Text>
        <Text style={s.sub}>{user ? user.email : ''}</Text>
        {user ? <View style={s.badge}><Badge text={user.role} /></View> : null}
      </Card>

      {/* Language belongs to the person, not to the app. The owner can run
          this in English while every customer uses their own. */}
      <Card>
        <Row title={t('chooseLanguage')}
             right={(LANGUAGES.find(l => l.code === lang) || {}).native}
             onPress={() => setOpen(o => !o)} />
        {open ? LANGUAGES.map(l => (
          <Row key={l.code} title={l.native} sub={l.label}
               right={l.code === lang ? '✓' : ''}
               onPress={() => { setLang(l.code); setOpen(false); }} />
        )) : null}
      </Card>

      <Card>
        <Row title="Country and region" right="›" onPress={() => navigation.navigate('Region')} />
        <Row title="Privacy" right="›" onPress={() => navigation.navigate('Privacy')} />
        <Row title="Help" right="›" onPress={() => navigation.navigate('Help')} />
      </Card>

      <Button title={t('signOut')} kind="ghost" onPress={signOut} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  name: { fontSize: theme.font.title, fontWeight: '800', color: theme.color.text },
  sub:  { color: theme.color.muted, marginTop: 2 },
  badge:{ flexDirection: 'row', marginTop: theme.space.sm },
});
`;
}

const BUILDERS = {
  list: listScreen, form: formScreen, detail: detailScreen, pay: payScreen,
  chat: chatScreen, summary: summaryScreen, map: mapScreen,
  scan: scanScreen, settings: settingsScreen,
};

function screenCode(a, label, path) {
  return BUILDERS[kindOf(label)](a, label, path);
}

module.exports = { comp, kindOf, screenCode, BUILDERS, has };
