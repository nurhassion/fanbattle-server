'use strict';
/*
 * gen-project.js — package.json, .gitignore, .env.example, App.js, রুট
 *
 * ⚠️ package.json ছাড়া npm install চলেই না। এটা বাদ পড়লে ZIP নামিয়ে
 * দর্শক প্রথম ধাপেই আটকে যেত।
 *
 * ⚠️ .gitignore-এ .env থাকা জরুরি। নাহলে দর্শক নিজের গোপন চাবি GitHub-এ
 * তুলে দেবে, আর ওটা মুছলেও ইতিহাসে থেকে যায়। এই একটা লাইন বহু মানুষকে
 * বহু কষ্ট থেকে বাঁচায়।
 */

function packageJson(a) {
  return JSON.stringify({
    name: a.slug || 'app',
    version: '1.0.0',
    private: true,
    description: (a.name + ' — built live on Code Knowledge'),
    scripts: {
      start: 'node server/index.js',
      app: 'expo start',
      'app:android': 'expo start --android',
      'app:web': 'expo start --web',
      seed: 'node server/seed.js',
    },
    dependencies: {
      'expo': '~51.0.0',
      'react': '18.2.0',
      'react-native': '0.74.5',
      '@react-navigation/native': '^6.1.17',
      '@react-navigation/native-stack': '^6.9.26',
      '@react-navigation/bottom-tabs': '^6.5.20',
      'react-native-screens': '~3.31.1',
      'react-native-safe-area-context': '4.10.5',
      '@react-native-async-storage/async-storage': '1.23.1',
      'express': '^4.19.2',
      'better-sqlite3': '^11.0.0',
      'jsonwebtoken': '^9.0.2',
      'bcryptjs': '^2.4.3',
      'livekit-server-sdk': '^2.5.0',
      'dotenv': '^16.4.5',
    },
    engines: { node: '>=18' },
  }, null, 2) + '\n';
}

function gitignore() {
  return `# Never commit these.
#
# .env holds the secret keys setup created for you. If it reaches GitHub,
# anyone can sign tokens as any user of your app. And deleting the file
# later does not help, because it stays in the history forever.
.env
.env.*
!.env.example

node_modules/
*.db
*.db-journal
*.db-wal
uploads/
.expo/
dist/
build/
.DS_Store
npm-debug.log*
`;
}

function envExample(a) {
  return `# .env.example — copy this to .env, or just run setup and it does it for you.
#
# The two secrets below must be YOUR OWN random values. If everybody who
# downloads this keeps the same ones, one person's mistake affects every
# other person's users. setup.ps1 and setup.sh generate them for you.

JWT_SECRET=change-me
REFRESH_SECRET=change-me-too
DATABASE_URL=file:./data.db
PORT=4000

# ---------------------------------------------------------------
# Everything below is optional. ${a.name} runs without any of it,
# using local files, so you can build the whole thing before paying
# for anything. Fill these in when you are ready for real users.
# ---------------------------------------------------------------

# File storage. Free to start: Cloudflare R2 gives 10 GB and charges
# nothing for downloads, which is the part that usually hurts.
STORAGE_ENDPOINT=
STORAGE_BUCKET=
STORAGE_KEY=
STORAGE_SECRET=

# Live classes and calls. LiveKit is open source; their hosted plan is
# free up to roughly fifty hours a month. Plenty while you are starting.
LIVEKIT_URL=
LIVEKIT_KEY=
LIVEKIT_SECRET=

# Payments. Use the TEST keys first. Every provider gives you a set of
# test card numbers so you can take a hundred fake payments safely.
PAYMENT_KEY=
PAYMENT_SECRET=
PAYMENT_WEBHOOK_SECRET=
`;
}

/* ---------------------------------------------------------------- App */
/* ⚠️ টেমপ্লেটের ভেতরে টেমপ্লেট লেখা যায় না — তাই টুকরোগুলো আগে বানিয়ে
   নেওয়া হচ্ছে, তারপর একবারে জোড়া হচ্ছে। */
function appJs(a) {
  const scr = a.screens.slice(0, 9);
  const imports = scr.map((s, i) =>
    "import S" + (i + 1) + " from './screens/" +
    String(i + 1).padStart(2, '0') + "-" + comp(s) + "';").join('\n');

  const tabs = scr.slice(0, 4).map((s, i) =>
    "      <Tabs.Screen name=\"S" + (i + 1) + "\" component={S" + (i + 1) +
    "} options={{ title: '" + s.replace(/&amp;/g, 'and').replace(/'/g, '') + "' }} />").join('\n');

  const stacked = scr.slice(4).map((s, i) =>
    "          <Stack.Screen name=\"S" + (i + 5) + "\" component={S" + (i + 5) +
    "} options={{ title: '" + s.replace(/&amp;/g, 'and').replace(/'/g, '') + "' }} />").join('\n');

  return `// App.js — where ${a.name} starts.
//
// Read this file first. It shows the shape of the whole app on one screen:
// who is signed in, what language they read, and which set of screens they
// are allowed to see.

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from './auth';
import { I18nProvider } from './i18n';
import { Loader } from './ui';
import { theme } from './theme';
import { APP } from './config';

import AuthScreen from './screens/AuthScreen';
import RolePickerScreen from './screens/RolePickerScreen';
${imports}
import { ProviderOnboardScreen, ProviderHomeScreen, ProviderEarningsScreen } from './Provider';
import { OwnerApprovalsScreen, OwnerMoneyScreen, OwnerStaffScreen, OwnerReportsScreen } from './Owner';

const Stack = createNativeStackNavigator();
const Tabs  = createBottomTabNavigator();

/* Each role gets its own set of tabs.
   This is NOT the security. The server decides what anyone may actually
   do. This only means a driver is not staring at an approvals queue they
   could never use anyway. */
function CustomerTabs() {
  return (
    <Tabs.Navigator screenOptions={{ tabBarActiveTintColor: theme.color.primary }}>
${tabs}
    </Tabs.Navigator>
  );
}

function ProviderTabs() {
  return (
    <Tabs.Navigator screenOptions={{ tabBarActiveTintColor: theme.color.primary }}>
      <Tabs.Screen name="Jobs"     component={ProviderHomeScreen}     options={{ title: 'Jobs' }} />
      <Tabs.Screen name="Earnings" component={ProviderEarningsScreen} options={{ title: 'Earnings' }} />
    </Tabs.Navigator>
  );
}

function OwnerTabs() {
  return (
    <Tabs.Navigator screenOptions={{ tabBarActiveTintColor: theme.color.primary }}>
      <Tabs.Screen name="Approvals" component={OwnerApprovalsScreen} options={{ title: 'Approvals' }} />
      <Tabs.Screen name="Money"     component={OwnerMoneyScreen}     options={{ title: 'Money' }} />
      <Tabs.Screen name="Team"      component={OwnerStaffScreen}     options={{ title: 'Team' }} />
      <Tabs.Screen name="Reports"   component={OwnerReportsScreen}   options={{ title: 'Reports' }} />
    </Tabs.Navigator>
  );
}

function Routes() {
  const { user, loading } = useAuth();
  if (loading) return <Loader label="Starting" />;

  return (
    <Stack.Navigator screenOptions={{ headerTitleStyle: { fontWeight: '700' } }}>
      {!user ? (
        <>
          <Stack.Screen name="Auth" component={AuthScreen} options={{ title: APP.name }} />
          <Stack.Screen name="RolePicker" component={RolePickerScreen} options={{ title: 'Welcome' }} />
        </>
      ) : user.role === 'owner' || user.role === 'staff' ? (
        <Stack.Screen name="Owner" component={OwnerTabs} options={{ headerShown: false }} />
      ) : user.role === 'provider' && user.providerStatus !== 'approved' ? (
        // Applied but not approved yet. Do not drop somebody into an empty
        // jobs list with no explanation. Tell them where they stand.
        <Stack.Screen name="ProviderOnboard" component={ProviderOnboardScreen}
                      options={{ title: 'Your application' }} />
      ) : user.role === 'provider' ? (
        <Stack.Screen name="Provider" component={ProviderTabs} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen name="Home" component={CustomerTabs} options={{ headerShown: false }} />
${stacked}
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AuthProvider>
          <NavigationContainer>
            <Routes />
          </NavigationContainer>
        </AuthProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
`;
}

/* ⚠️ gen-screens.js-ও হুবহু এই নিয়মে নাম বানায়। দুই জায়গায় আলাদা হলে
   ফাইল তৈরি হয় এক নামে, import খোঁজে অন্য নামে। */
function comp(label) {
  return String(label)
    .replace(/&amp;|&/g, 'And')
    .replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('')
    // JavaScript-এ নাম সংখ্যা দিয়ে শুরু হতে পারে না
    .replace(/^([0-9])/, 'Screen$1') + 'Screen';
}

module.exports = { packageJson, gitignore, envExample, appJs, comp };
