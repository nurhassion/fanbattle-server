'use strict';
/*
 * gen-ui.js — সব উপাদান এক ফাইলে
 *
 * ⚠️ কেন এক ফাইলে, আলাদা করে নয়
 * Button.js, Input.js, Card.js — এভাবে দশটা ফাইল করলে দর্শক ফোল্ডার খুলে
 * ঘাবড়ে যায়। তাই সব একসাথে। খুঁজতে সহজ, বোঝাতেও সহজ।
 *
 * ⚠️ Empty আর ErrorView কেন আছে
 * বেশিরভাগ শেখানো প্রকল্পে থাকে না, আর সেটাই আসল পার্থক্য। নতুন
 * ব্যবহারকারী প্রথমেই খালি পর্দা দেখে, আর দুর্বল নেটে ভুলের পর্দা দেখে।
 * ওই দুটো পর্দাই ঠিক করে সে থাকবে না চলে যাবে।
 */

function ui(a) {
  return `// ui.js — every reusable piece of ${a.name} lives here.
//
// One file on purpose. Ten tiny files called Button.js, Input.js, Card.js
// look tidy to a senior developer and terrifying to everyone else.

import React from 'react';
import {
  View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import { theme, shadow } from './theme';
import { ADS, KEYS } from './config';

/* ---------- Button ---------- */
// busy blocks a second tap. Without it, an impatient user on a slow
// connection sends the same payment twice, and you refund it out of your
// own pocket. This one prop has saved me real money.
export function Button({ title, onPress, busy, kind = 'primary', disabled }) {
  const dead = busy || disabled;
  const bg = kind === 'primary' ? theme.color.primary
           : kind === 'danger'  ? theme.color.danger
           : 'transparent';
  const fg = kind === 'ghost' ? theme.color.primary : theme.color.onPrimary;
  return (
    <Pressable
      onPress={dead ? undefined : onPress}
      style={[s.btn, { backgroundColor: bg, opacity: dead ? 0.55 : 1 },
              kind === 'ghost' && s.btnGhost]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!dead, busy: !!busy }}
    >
      {busy
        ? <ActivityIndicator color={fg} />
        : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

/* ---------- Input ---------- */
// The error sits under the field, not in a popup. Popups make people
// forget which box was wrong.
export function Input({ label, error, hint, ...rest }) {
  return (
    <View style={{ marginBottom: theme.space.md }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput
        style={[s.input, error && { borderColor: theme.color.danger }]}
        placeholderTextColor={theme.color.muted}
        {...rest}
      />
      {error ? <Text style={s.err}>{error}</Text>
             : hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

/* ---------- Card / Row ---------- */
export function Card({ children, style }) {
  return <View style={[s.card, shadow, style]}>{children}</View>;
}

export function Row({ title, sub, right, onPress }) {
  const Body = (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={s.rowSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {right ? <Text style={s.rowRight}>{right}</Text> : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{Body}</Pressable> : Body;
}

export function Badge({ text, tone = 'muted' }) {
  const c = tone === 'ok'   ? theme.color.success
          : tone === 'bad'  ? theme.color.danger
          : theme.color.muted;
  return (
    <View style={[s.badge, { borderColor: c }]}>
      <Text style={[s.badgeText, { color: c }]}>{text}</Text>
    </View>
  );
}

/* ---------- the three states everyone forgets ---------- */
export function Loader({ label = 'Loading' }) {
  return (
    <View style={s.center}>
      <ActivityIndicator color={theme.color.primary} />
      <Text style={s.muted}>{label}</Text>
    </View>
  );
}

// Say what the user can DO, not just that something is empty.
// "No orders yet" is a dead end. "No orders yet, share your link" is a path.
export function Empty({ title, hint, actionTitle, onAction }) {
  return (
    <View style={s.center}>
      <Text style={s.emptyTitle}>{title}</Text>
      {hint ? <Text style={s.muted}>{hint}</Text> : null}
      {actionTitle
        ? <View style={{ marginTop: theme.space.md, alignSelf: 'stretch' }}>
            <Button title={actionTitle} onPress={onAction} />
          </View>
        : null}
    </View>
  );
}

// Never show the raw technical error. Show what happened and a way out.
export function ErrorView({ error, onRetry }) {
  const offline = error && error.status === 0;
  return (
    <View style={s.center}>
      <Text style={s.emptyTitle}>
        {offline ? 'No connection' : 'Something went wrong'}
      </Text>
      <Text style={s.muted}>
        {offline
          ? 'Check your network and try again. Nothing was lost.'
          : (error && error.message) || 'Please try again.'}
      </Text>
      {onRetry
        ? <View style={{ marginTop: theme.space.md, alignSelf: 'stretch' }}>
            <Button title="Try again" onPress={onRetry} kind="ghost" />
          </View>
        : null}
    </View>
  );
}

/* ---------- ads ----------
   One component, used in a few places, switched off from config.js.
   Never place this on a payment screen. An advert next to a Pay button
   costs you more in abandoned payments than it earns in a year. */
export function AdSlot({ where }) {
  if (!ADS.enabled || !KEYS.ads) return null;
  if (where && ADS[where] === false) return null;
  return (
    <View style={s.ad}>
      <Text style={s.adLabel}>Sponsored</Text>
    </View>
  );
}

const s = StyleSheet.create({
  btn: { paddingVertical: 14, borderRadius: theme.radius.md, alignItems: 'center' },
  btnGhost: { borderWidth: 1, borderColor: theme.color.primary },
  btnText: { fontSize: theme.font.body, fontWeight: '700' },
  label: { fontSize: theme.font.small, color: theme.color.muted, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.sm,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: theme.font.body, color: theme.color.text,
  },
  err:  { color: theme.color.danger, fontSize: theme.font.small, marginTop: 6 },
  hint: { color: theme.color.muted,  fontSize: theme.font.small, marginTop: 6 },
  card: {
    backgroundColor: theme.color.bg, borderRadius: theme.radius.md,
    padding: theme.space.md, marginBottom: theme.space.md,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  rowTitle: { fontSize: theme.font.body, color: theme.color.text, fontWeight: '600' },
  rowSub:   { fontSize: theme.font.small, color: theme.color.muted, marginTop: 2 },
  rowRight: { fontSize: theme.font.small, color: theme.color.muted, marginLeft: 12 },
  badge: { borderWidth: 1, borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: theme.font.small, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },
  muted: { color: theme.color.muted, fontSize: theme.font.body, textAlign: 'center', marginTop: 6 },
  emptyTitle: { fontSize: theme.font.title, fontWeight: '700', color: theme.color.text, textAlign: 'center' },
  ad: {
    height: 64, borderRadius: theme.radius.sm, backgroundColor: theme.color.surface,
    alignItems: 'center', justifyContent: 'center', marginBottom: theme.space.md,
  },
  adLabel: { fontSize: theme.font.small, color: theme.color.muted },
});
`;
}

module.exports = { ui };
