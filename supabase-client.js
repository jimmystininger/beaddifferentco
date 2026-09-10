const beadSupabaseUrl='https://zejcuqhihbfpuwsjvmhc.supabase.co';
const beadSupabasePublishableKey='sb_publishable_f_xtefICK9H7dD7jJghxJQ_7vcEjR-N';
window.beadSupabase=window.supabase?.createClient(beadSupabaseUrl,beadSupabasePublishableKey);
window.beadSupabaseReady=Promise.resolve(window.beadSupabase);
