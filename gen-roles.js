'use strict';
/*
 * gen-roles.js — সেবাদাতা আর মালিকের পর্দা
 *
 * ⚠️ এই দুটো ফাইলই অ্যাপটাকে ব্যবসা বানায়। শুধু গ্রাহকের পর্দা থাকলে
 * ওটা একটা প্রদর্শনী, ব্যবসা নয়।
 *
 * ⚠️ নিরাপত্তার কথা আবার: এখানে যা লুকানো আছে তা শুধু দেখতে ভালো লাগার
 * জন্য। আসল পাহারা server.js-এর requireRole ও ownsOr-এ। কেউ অ্যাপ না
 * খুলেই সরাসরি সার্ভারে অনুরোধ পাঠাতে পারে।
 */

function providerFile(a) {
  return `// Provider.js — the side that earns money on ${a.name}.
//
// Three screens in one file: joining, working, getting paid.
// Kept together because a provider moves between them constantly, and
// splitting them into three files helps nobody except a linter.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { api } from './api';
import { theme } from './theme';
import { useT } from './i18n';
import { useAuth } from './auth';
import { money, requiredDocuments, BANK_FIELDS } from './helpers';
import { Button, Input, Card, Row, Badge, Loader, Empty, ErrorView } from './ui';

/* ================================================================
   1. Joining — documents
   ================================================================
   Which papers you ask for depends on the country, not on your opinion.
   requiredDocuments() reads it from config.js. Do not hard-code your own
   country's documents here; your providers will not all live where you do.

   NOTE: uploading identity documents makes you responsible for them.
   Store the file, not the number. Never log them. Delete them when the
   account closes. Your local privacy law will say more; read it. */
export function ProviderOnboardScreen({ navigation }) {
  const { t } = useT();
  const docs = requiredDocuments();
  const [files, setFiles]   = useState({});
  const [bank, setBank]     = useState({});
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);

  const missing = docs.filter(d => !files[d]);

  async function submit() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api.post('/provider/apply', { documents: files, bank });
      navigation.replace('ProviderPending');
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <ScrollView style={s.wrap}>
      <Card>
        <Text style={s.h}>{t('documents')}</Text>
        <Text style={s.p}>
          These are the documents required in your country. Nothing is sent
          anywhere until you press submit.
        </Text>
        {docs.map(d => (
          <Row key={d} title={d}
               right={files[d] ? 'Added' : 'Add'}
               onPress={() => setFiles(f => ({ ...f, [d]: 'pending-upload' }))} />
        ))}
      </Card>

      <Card>
        <Text style={s.h}>Where you get paid</Text>
        {BANK_FIELDS.map(f => (
          <Input key={f} label={f} value={bank[f] || ''}
                 onChangeText={v => setBank(b => ({ ...b, [f]: v }))} />
        ))}
        <Text style={s.p}>
          Money is held for a few days before payout so refunds can settle.
          You will see the exact date on every payment.
        </Text>
      </Card>

      {error ? <Text style={s.err}>{error.message}</Text> : null}
      <Button title={t('continue')} busy={busy}
              disabled={missing.length > 0}
              onPress={submit} />
      {missing.length
        ? <Text style={s.p}>Still needed: {missing.join(', ')}</Text>
        : null}
    </ScrollView>
  );
}

/* ================================================================
   2. Working — the jobs that came in
   ================================================================ */
export function ProviderHomeScreen({ navigation }) {
  const { t } = useT();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [refreshing, setRef]  = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      // The server returns only this provider's jobs. It does not trust an
      // id sent from the phone. If it did, provider 12 could read
      // provider 77's work by changing one number in the URL.
      setItems((await api.get('/provider/orders')).items || []);
    } catch (e) { setError(e); } finally { setLoading(false); setRef(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Loader label={t('loading')} />;
  if (error)   return <ErrorView error={error} onRetry={() => { setLoading(true); load(); }} />;

  if (!items.length) {
    return (
      <Empty
        title="No jobs yet"
        hint="New requests appear here. Share your link to get the first one."
        actionTitle={t('retry')}
        onAction={() => { setLoading(true); load(); }}
      />
    );
  }

  return (
    <FlatList
      style={s.wrap}
      data={items}
      keyExtractor={i => String(i.id)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRef(true); load(); }} />}
      renderItem={({ item }) => (
        <Row title={item.title} sub={item.when}
             right={money(item.payoutMinor)}
             onPress={() => navigation.navigate('OrderDetail', { id: item.id })} />
      )}
    />
  );
}

/* ================================================================
   3. Getting paid
   ================================================================
   Show the split openly. A provider who can see exactly what was taken
   and why will argue once and then trust you. One who cannot see it
   assumes the worst, and leaves. */
export function ProviderEarningsScreen() {
  const { t } = useT();
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { api.get('/provider/earnings').then(setData).catch(setError); }, []);

  if (!data && !error) return <Loader label={t('loading')} />;
  if (error && !data)  return <ErrorView error={error} />;

  return (
    <ScrollView style={s.wrap}>
      <Card>
        <Text style={s.k}>{t('earnings')}</Text>
        <Text style={s.big}>{money(data.availableMinor)}</Text>
        <Text style={s.k}>{t('pending')} {money(data.pendingMinor)}</Text>
      </Card>

      <Card>
        <Text style={s.h}>How this was worked out</Text>
        <View style={s.line}><Text style={s.k}>Jobs completed</Text><Text style={s.v}>{data.jobs}</Text></View>
        <View style={s.line}><Text style={s.k}>Customers paid</Text><Text style={s.v}>{money(data.grossMinor)}</Text></View>
        <View style={s.line}><Text style={s.k}>{t('commission')}</Text><Text style={s.v}>− {money(data.commissionMinor)}</Text></View>
        <View style={s.line}><Text style={s.kb}>Yours</Text><Text style={s.vb}>{money(data.netMinor)}</Text></View>
      </Card>

      <Button title={t('payout')} disabled={!data.canPayout}
              onPress={() => api.post('/provider/payout', {})} />
      {!data.canPayout
        ? <Text style={s.p}>Next payout {data.nextPayoutDate}. Money is held a few days so refunds can settle.</Text>
        : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  h:  { fontSize: theme.font.title, fontWeight: '800', color: theme.color.text, marginBottom: 6 },
  p:  { color: theme.color.muted, fontSize: theme.font.small, lineHeight: 20, marginTop: 8 },
  k:  { color: theme.color.muted, fontSize: theme.font.body },
  v:  { color: theme.color.text,  fontSize: theme.font.body },
  kb: { color: theme.color.text,  fontSize: theme.font.title, fontWeight: '800' },
  vb: { color: theme.color.text,  fontSize: theme.font.title, fontWeight: '800' },
  big:{ color: theme.color.text,  fontSize: 34, fontWeight: '800', marginVertical: 4 },
  line:{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  err: { color: theme.color.danger, marginBottom: theme.space.md },
});
`;
}

function ownerFile(a) {
  return `// Owner.js — the side that runs ${a.name}.
//
// SECURITY, read once and remember it:
//
// Everything on these screens is also checked on the server. What this
// file does is decide what to SHOW. Hiding a screen stops an honest
// person wandering in. It does not stop anybody who is trying.
//
// The owner can LOOK at other people's records, because support work
// needs it. The owner cannot ACT as somebody else. Placing an order in a
// customer's name, or sending a provider's payout somewhere new, is not
// support work, and server.js refuses it even for the owner.
//
// Every time an owner opens somebody else's record, it is written down.
// A look that leaves no trace cannot be told apart from theft.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, FlatList, StyleSheet } from 'react-native';
import { api } from './api';
import { theme } from './theme';
import { useT } from './i18n';
import { useAuth, PERMISSIONS, Guard } from './auth';
import { money } from './helpers';
import { Button, Input, Card, Row, Badge, Loader, Empty, ErrorView } from './ui';

/* ---------- 1. Who is waiting to be approved ---------- */
export function OwnerApprovalsScreen({ navigation }) {
  const { t } = useT();
  const { can } = useAuth();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    try { setError(null); setItems((await api.get('/owner/applications')).items || []); }
    catch (e) { setError(e); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function decide(id, ok) {
    await api.post('/owner/applications/' + id, { approved: ok });
    load();
  }

  if (loading) return <Loader label={t('loading')} />;
  if (error)   return <ErrorView error={error} onRetry={load} />;
  if (!items.length) return <Empty title="Nobody waiting" hint="New applications appear here." />;

  return (
    <FlatList
      style={s.wrap}
      data={items}
      keyExtractor={i => String(i.id)}
      renderItem={({ item }) => (
        <Card>
          <Text style={s.h}>{item.name}</Text>
          <Text style={s.p}>{item.documentsSummary}</Text>
          <Guard perm="providers.approve" fallback={<Text style={s.p}>View only</Text>}>
            <View style={s.rowBtns}>
              <View style={{ flex: 1 }}>
                <Button title={t('approved')} onPress={() => decide(item.id, true)} />
              </View>
              <View style={{ width: 10 }} />
              <View style={{ flex: 1 }}>
                <Button title={t('cancel')} kind="danger" onPress={() => decide(item.id, false)} />
              </View>
            </View>
          </Guard>
        </Card>
      )}
    />
  );
}

/* ---------- 2. Money settings ---------- */
export function OwnerMoneyScreen() {
  const { t } = useT();
  const { can } = useAuth();
  const [pct, setPct]     = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy]   = useState(false);

  useEffect(() => { api.get('/owner/settings').then(r => setPct(String(r.commissionPercent))).catch(setError); }, []);

  async function save() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      // Changing your cut changes what every provider earns tomorrow.
      // Tell them before you do it, not after. People forgive a rise they
      // were warned about and leave over one they were not.
      await api.patch('/owner/settings', { commissionPercent: Number(pct) });
      setSaved(true);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <ScrollView style={s.wrap}>
      <Card>
        <Input label={t('commission') + ' %'} value={pct} onChangeText={setPct}
               keyboardType="numeric"
               hint="Start low. You can raise it once providers trust you." />
        {error ? <Text style={s.err}>{error.message}</Text> : null}
        {saved ? <Text style={s.ok}>Saved. It applies to new orders only.</Text> : null}
        <Guard perm="commission.edit" fallback={<Text style={s.p}>You can view this but not change it.</Text>}>
          <Button title={t('save')} onPress={save} busy={busy} />
        </Guard>
      </Card>
    </ScrollView>
  );
}

/* ---------- 3. Staff and what they may do ----------
   This is how a one-person app becomes a company. You bring somebody in
   to answer messages, and you give them exactly that and nothing else.
   Do not share your own login. Ever. When they leave you would have to
   change a password everybody knows, and you will forget. */
export function OwnerStaffScreen() {
  const { t } = useT();
  const [staff, setStaff] = useState([]);
  const [email, setEmail] = useState('');
  const [picked, setPicked] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try { setStaff((await api.get('/owner/staff')).items || []); } catch (e) { setError(e); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function invite() {
    try {
      await api.post('/owner/staff', { email, permissions: picked });
      setEmail(''); setPicked([]); load();
    } catch (e) { setError(e); }
  }

  return (
    <ScrollView style={s.wrap}>
      <Card>
        <Text style={s.h}>Your team</Text>
        {staff.length
          ? staff.map(m => (
              <Row key={m.id} title={m.email} sub={(m.permissions || []).join(', ') || 'no permissions'}
                   right="Edit" onPress={() => {}} />
            ))
          : <Text style={s.p}>Nobody yet. It is just you.</Text>}
      </Card>

      <Guard perm="staff.manage" fallback={null}>
        <Card>
          <Text style={s.h}>Invite someone</Text>
          <Input label="Their email" value={email} onChangeText={setEmail}
                 autoCapitalize="none" keyboardType="email-address" />
          <Text style={s.p}>Tick only what they need. You can change it later.</Text>
          {PERMISSIONS.map(p => (
            <Row key={p} title={p}
                 right={picked.includes(p) ? '✓' : ''}
                 onPress={() => setPicked(v => v.includes(p) ? v.filter(x => x !== p) : v.concat(p))} />
          ))}
          {error ? <Text style={s.err}>{error.message}</Text> : null}
          <Button title="Send invite" onPress={invite} disabled={!email.trim()} />
        </Card>
      </Guard>
    </ScrollView>
  );
}

/* ---------- 4. How the business is doing ---------- */
export function OwnerReportsScreen() {
  const { t } = useT();
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api.get('/owner/reports').then(setData).catch(setError); }, []);

  if (!data && !error) return <Loader label={t('loading')} />;
  if (error && !data)  return <ErrorView error={error} />;

  // Three numbers. Not forty. The day you know these three you stop
  // guessing and start running a business.
  return (
    <ScrollView style={s.wrap}>
      <Card>
        <View style={s.line}><Text style={s.k}>Orders this month</Text><Text style={s.v}>{data.orders}</Text></View>
        <View style={s.line}><Text style={s.k}>Money through the app</Text><Text style={s.v}>{money(data.grossMinor)}</Text></View>
        <View style={s.line}><Text style={s.kb}>Your earnings</Text><Text style={s.vb}>{money(data.commissionMinor)}</Text></View>
      </Card>
      <Card>
        <View style={s.line}><Text style={s.k}>Active providers</Text><Text style={s.v}>{data.providers}</Text></View>
        <View style={s.line}><Text style={s.k}>Customers who came back</Text><Text style={s.v}>{data.returning}</Text></View>
      </Card>
      <Text style={s.p}>
        The one to watch is the last line. New customers cost money to find.
        Returning ones are free, and they are the whole business.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  h:  { fontSize: theme.font.title, fontWeight: '800', color: theme.color.text, marginBottom: 6 },
  p:  { color: theme.color.muted, fontSize: theme.font.small, lineHeight: 20, marginTop: 8 },
  k:  { color: theme.color.muted, fontSize: theme.font.body },
  v:  { color: theme.color.text,  fontSize: theme.font.body },
  kb: { color: theme.color.text,  fontSize: theme.font.title, fontWeight: '800' },
  vb: { color: theme.color.text,  fontSize: theme.font.title, fontWeight: '800' },
  line:{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowBtns: { flexDirection: 'row', marginTop: theme.space.md },
  err: { color: theme.color.danger, marginBottom: theme.space.md },
  ok:  { color: theme.color.success, marginBottom: theme.space.md },
});
`;
}

module.exports = { providerFile, ownerFile };
