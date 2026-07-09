const { createClient } = require('@supabase/supabase-js');

let client;

function getServiceClient() {
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
  }
  return client;
}

module.exports = { getServiceClient };
