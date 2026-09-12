'use strict';
/*
 * gen-entry.js — ঢোকার দুটো পর্দা
 *
 * ⚠️ RolePickerScreen-এ দেশ আর ভাষা একসাথে বাছা হয় — ইচ্ছে করেই।
 * দেশ বাছলেই ঠিক হয়ে যায় কোন মুদ্রা, কোন ফোন কোড, আর সেবাদাতা হলে
 * কোন নথি লাগবে। ভাষা আলাদা, কারণ দুবাইয়ে থাকা একজন হিন্দিতে পড়তে
 * পারেন। দেশ আর ভাষা এক জিনিস নয়।
 *
 * ⚠️ ভূমিকা বাছার পর্দাটা প্রথমেই আসে, লগইনের পরে নয়। কারণ সেবাদাতার
 * নিবন্ধনে অনেক বেশি তথ্য লাগে, আর কে কী হতে চায় সেটা আগে জানলে
 * অপ্রয়োজনীয় ঘর দেখাতেই হয় না।
 */

function authScreen(a) {
  return `// AuthScreen.js — signing in and joining ${a.name}.
//
// One screen, two modes. Separate login and register screens mean two
// files that drift apart; here the difference is three extra fields.

import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { api } from '../api';
import { theme } from '../theme';
import { useT } from '../i18n';
import { useAuth } from '../auth';
import { checkForm, DIAL_CODE } from '../helpers';
import { Button, Input, Card } from '../ui';

export default function AuthScreen({ navigation }) {
  const { t } = useT();
  const { signIn } = useAuth();
  const [mode, setMode]   = useState('login');   // login | join
  const [form, setForm]   = useState({ name: '', identifier: '', password: '' });
  const [errors, setErr]  = useState({});
  const [busy, setBusy]   = useState(false);
  const [failed, setFail] = useState(null);

  const joining = mode === 'join';
  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErr(e => ({ ...e, [k]: undefined }));
  };

  async function go() {
    const rules = {
      identifier: { value: form.identifier, required: true },
      password:   { value: form.password, required: true, min: 8 },
    };
    if (joining) rules.name = { value: form.name, required: true, min: 2 };
    const { errors: found, ok } = checkForm(rules);
    setErr(found);
    if (!ok) return;

    setBusy(true);
    setFail(null);
    try {
      if (joining) {
        await api.post('/auth/register', form);
        // Straight to the role question. Making somebody sign in again
        // right after they signed up is a small insult that loses people.
        navigation.replace('RolePicker');
      } else {
        await signIn(form.identifier, form.password);
      }
    } catch (e) {
      // Deliberately vague on login. "No such email" tells anyone who
      // asks which addresses are registered here.
      setFail(joining ? e : { message: 'Those details did not match. Please check and try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.wrap} keyboardShouldPersistTaps="handled">
      <Text style={s.hero}>{joining ? t('signUp') : t('signIn')}</Text>
      <Card>
        {joining
          ? <Input label="Your name" value={form.name} onChangeText={v => set('name', v)}
                   error={errors.name} />
          : null}
        <Input label={t('email') + ' or ' + t('phone')}
               value={form.identifier} onChangeText={v => set('identifier', v)}
               autoCapitalize="none" error={errors.identifier}
               hint={'Phone numbers start with ' + DIAL_CODE} />
        <Input label={t('password')} value={form.password} secureTextEntry
               onChangeText={v => set('password', v)} error={errors.password}
               hint="At least 8 characters" />
        {failed ? <Text style={s.err}>{failed.message}</Text> : null}
        <Button title={joining ? t('signUp') : t('signIn')} onPress={go} busy={busy} />
      </Card>
      <Button kind="ghost"
              title={joining ? 'I already have an account' : 'Create an account'}
              onPress={() => { setMode(joining ? 'login' : 'join'); setFail(null); setErr({}); }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  hero: { fontSize: theme.font.hero, fontWeight: '800', color: theme.color.text,
          marginVertical: theme.space.lg },
  err:  { color: theme.color.danger, marginBottom: theme.space.md },
});
`;
}

function rolePickerScreen(a) {
  return `// RolePickerScreen.js — country, language, and which side you are on.
//
// WHY ALL THREE HERE, BEFORE ANYTHING ELSE:
//
// Country decides your currency, your phone prefix, and — if you are
// offering services — which documents the law asks you for. Getting that
// wrong later means redoing the whole application.
//
// Language is separate from country, deliberately. Somebody living in
// Dubai may well read Hindi. Country is where you are; language is how
// you read. Treating them as one thing is a mistake almost every app
// makes, and it quietly excludes people.
//
// Role is asked first because a provider has to send far more information.
// Knowing who you are talking to means never showing the wrong fields.

import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { api } from '../api';
import { theme } from '../theme';
import { useT } from '../i18n';
import { useAuth } from '../auth';
import { Button, Card, Row } from '../ui';
import { LANGUAGES } from '../i18n';
import { COUNTRIES } from '../countries';

export default function RolePickerScreen({ navigation }) {
  const { t, lang, setLang } = useT();
  const [country, setCountry] = useState('${a.country || 'IN'}');
  const [role, setRole]       = useState(null);
  const [open, setOpen]       = useState(null);   // 'country' | 'lang' | null
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);

  const list = Object.keys(COUNTRIES);

  async function go() {
    if (!role || busy) return;
    setBusy(true); setError(null);
    try {
      await api.patch('/me', { country, lang, role });
      // A provider goes to the documents step. A customer is done and
      // can start using the app straight away.
      navigation.replace(role === 'provider' ? 'ProviderOnboard' : 'Home');
    } catch (e) { setError(e); setBusy(false); }
  }

  return (
    <ScrollView style={s.wrap}>
      <Card>
        <Row title={t('chooseCountry')}
             right={COUNTRIES[country] ? COUNTRIES[country].name : country}
             onPress={() => setOpen(o => (o === 'country' ? null : 'country'))} />
        {open === 'country' ? list.map(c => (
          <Row key={c} title={COUNTRIES[c].name}
               sub={COUNTRIES[c].cur + '  ' + COUNTRIES[c].dial}
               right={c === country ? '✓' : ''}
               onPress={() => { setCountry(c); setOpen(null); }} />
        )) : null}
      </Card>

      <Card>
        <Row title={t('chooseLanguage')}
             right={(LANGUAGES.find(l => l.code === lang) || {}).native}
             onPress={() => setOpen(o => (o === 'lang' ? null : 'lang'))} />
        {open === 'lang' ? LANGUAGES.map(l => (
          <Row key={l.code} title={l.native} sub={l.label}
               right={l.code === lang ? '✓' : ''}
               onPress={() => { setLang(l.code); setOpen(null); }} />
        )) : null}
      </Card>

      <Card>
        <Text style={s.h}>How will you use ${a.name}?</Text>
        <Row title={t('iAmCustomer')} right={role === 'customer' ? '✓' : ''}
             onPress={() => setRole('customer')} />
        <Row title={t('iAmProvider')}
             sub="You will be asked for a few documents"
             right={role === 'provider' ? '✓' : ''}
             onPress={() => setRole('provider')} />
        <Text style={s.p}>You can change this later from settings.</Text>
      </Card>

      {error ? <Text style={s.err}>{error.message}</Text> : null}
      <Button title={t('continue')} onPress={go} busy={busy} disabled={!role} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  h: { fontSize: theme.font.title, fontWeight: '800', color: theme.color.text, marginBottom: 6 },
  p: { color: theme.color.muted, fontSize: theme.font.small, marginTop: 8 },
  err: { color: theme.color.danger, marginBottom: theme.space.md },
});
`;
}

/* countries.js অ্যাপের দিকেও লাগে — সার্ভারেরটার হুবহু নকল নয়, শুধু
   যেটুকু পর্দায় দেখাতে হয় সেটুকু। পুরো নিয়মের তালিকা ফোনে পাঠানোর
   দরকার নেই, আর পাঠালে ফাইলটা অকারণে বড় হয়। */
function countriesClient(a, COUNTRIES) {
  const slim = {};
  Object.keys(COUNTRIES).forEach(k => {
    const c = COUNTRIES[k];
    slim[k] = { name: c.name, cur: c.cur, sym: c.sym, dial: c.dial };
  });
  return `// countries.js — just enough for the app to show the picker.
// The full document rules live on the server, where they are enforced.

export const COUNTRIES = ${JSON.stringify(slim, null, 2)};
`;
}

module.exports = { authScreen, rolePickerScreen, countriesClient };
