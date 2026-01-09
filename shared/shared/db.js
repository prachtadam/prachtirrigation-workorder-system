
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { getConfig } from './config.js';
import { JOB_STATUSES } from './types.js';

let client;

function getClient() {
  if (client) return client;
  const { supabaseUrl, supabaseAnonKey } = getConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase configuration missing. Please set SUPABASE_URL and SUPABASE_ANON_KEY.');
  }
  client = createClient(supabaseUrl, supabaseAnonKey);
  return client;
}

function requireOrgId() {
  const { orgId } = getConfig();
  if (!orgId) {
    throw new Error('ORG_ID missing. Please set ORG_ID in localStorage or window.SUPABASE_ORG_ID.');
  }
  return orgId;
}

function handleError(error, context) {
  if (error) {
    console.error('Supabase error:', context, error);
    const message = error.message || 'Unexpected error.';
    throw new Error(`${context}: ${message}`);
  }
}

async function listTable(table) {
  const orgId = requireOrgId();
  const { data, error } = await getClient()
    .from(table)
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  handleError(error, `Load ${table}`);
  return data || [];
}

async function insertTable(table, payload) {
  const orgId = requireOrgId();
  const { data, error } = await getClient()
    .from(table)
    .insert({ ...payload, org_id: orgId })
    .select()
    .single();
  handleError(error, `Create ${table}`);
  return data;
}

async function updateTable(table, id, payload) {
  const { data, error } = await getClient()
    .from(table)
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  handleError(error, `Update ${table}`);
  return data;
}

async function deleteTable(table, id) {
  const { error } = await getClient().from(table).delete().eq('id', id);
  handleError(error, `Delete ${table}`);
}

export async function getBootData() {
  const [customers, fields, trucks, users, jobTypes, products, tools, requestTypes, receiptTypes] = await Promise.all([
    listTable('customers'),
    listTable('fields'),
    listTable('trucks'),
    listTable('users'),
    listTable('job_types'),
    listTable('products'),
    listTable('tools'),
    listTable('request_types'),
    listTable('receipt_types'),
  ]);
  return { customers, fields, trucks, users, jobTypes, products, tools, requestTypes, receiptTypes };
}

export async function listCustomers() { return listTable('customers'); }
export async function createCustomer(payload) { return insertTable('customers', payload); }
export async function updateCustomer(id, payload) { return updateTable('customers', id, payload); }
export async function deleteCustomer(id) { return deleteTable('customers', id); }

export async function listFields() { return listTable('fields'); }
export async function createField(payload) { return insertTable('fields', payload); }
export async function updateField(id, payload) { return updateTable('fields', id, payload); }
export async function deleteField(id) { return deleteTable('fields', id); }

export async function listTrucks() { return listTable('trucks'); }
export async function createTruck(payload) { return insertTable('trucks', payload); }
export async function updateTruck(id, payload) { return updateTable('trucks', id, payload); }
export async function deleteTruck(id) { return deleteTable('trucks', id); }

export async function listUsers() { return listTable('users'); }
export async function createUser(payload) { return insertTable('users', payload); }
export async function updateUser(id, payload) { return updateTable('users', id, payload); }
export async function deleteUser(id) { return deleteTable('users', id); }

export async function listJobTypes() { return listTable('job_types'); }
export async function createJobType(payload) { return insertTable('job_types', payload); }
export async function updateJobType(id, payload) { return updateTable('job_types', id, payload); }
export async function deleteJobType(id) { return deleteTable('job_types', id); }

export async function listRequestTypes() { return listTable('request_types'); }
export async function createRequestType(payload) { return insertTable('request_types', payload); }
export async function updateRequestType(id, payload) { return updateTable('request_types', id, payload); }
export async function deleteRequestType(id) { return deleteTable('request_types', id); }

export async function listReceiptTypes() { return listTable('receipt_types'); }
export async function createReceiptType(payload) { return insertTable('receipt_types', payload); }
export async function updateReceiptType(id, payload) { return updateTable('receipt_types', id, payload); }
export async function deleteReceiptType(id) { return deleteTable('receipt_types', id); }

export async function listProducts() { return listTable('products'); }
export async function createProduct(payload) { return insertTable('products', payload); }
export async function updateProduct(id, payload) { return updateTable('products', id, payload); }
export async function deleteProduct(id) { return deleteTable('products', id); }

export async function listTools() { return listTable('tools'); }
export async function createTool(payload) { return insertTable('tools', payload); }
export async function updateTool(id, payload) { return updateTable('tools', id, payload); }
export async function deleteTool(id) { return deleteTable('tools', id); }

export async function listTruckTools(truckId) {
  const orgId = requireOrgId();
  const { data, error } = await getClient()
    .from('truck_tools')
    .select('*, tools(*)')
    .eq('org_id', orgId)
    .eq('truck_id', truckId)
    .order('created_at', { ascending: true });
  handleError(error, 'Load truck tools');
  return data || [];
}

export async function addTruckTool(payload) { return insertTable('truck_tools', payload); }
export async function deleteTruckTool(id) { return deleteTable('truck_tools', id); }

export async function listTruckInventory(truckId) {
  const orgId = requireOrgId();
  const { data, error } = await getClient()
    .from('truck_inventory')
    .select('*, products(*)')
    .eq('org_id', orgId)
    .eq('truck_id', truckId)
    .order('created_at', { ascending: true });
  handleError(error, 'Load truck inventory');
  return data || [];
}

export async function upsertTruckInventory({ truck_id, product_id, qty }) {
  const orgId = requireOrgId();
  const { data, error } = await getClient()
    .from('truck_inventory')
    .upsert({ org_id: orgId, truck_id, product_id, qty }, { onConflict: 'truck_id,product_id' })
    .select()
    .single();
  handleError(error, 'Update truck inventory');
  return data;
}

export async function listJobs(filter = {}) {
  const orgId = requireOrgId();
  let query = getClient()
    .from('jobs')
    .select(`
      *,
      customers (*),
      fields (*),
      job_types (*),
      users (*),
      trucks (*),
      attachments (*)
    `)
    .eq('org_id', orgId);

  if (filter.status) {
    query = query.eq('status', filter.status);
  }
  if (filter.statuses) {
    query = query.in('status', filter.statuses);
  }
  if (filter.finishedAfter) {
    query = query.gte('finished_at', filter.finishedAfter);
  }
  if (filter.invoicedAfter) {
    query = query.gte('invoiced_at', filter.invoicedAfter);
  }

  const { data, error } = await query.order('created_at', { ascending: true });
  handleError(error, 'Load jobs');
  return data || [];
}

export async function listActiveJobEvents(jobIds = []) {
  const orgId = requireOrgId();
  if (!jobIds.length) return [];
  const { data, error } = await getClient()
    .from('job_events')
    .select('*')
    .eq('org_id', orgId)
    .in('job_id', jobIds)
    .is('ended_at', null);
  handleError(error, 'Load active job events');
  return data || [];
}

export async function getJob(jobId) {
  const orgId = requireOrgId();
  const { data, error } = await getClient()
    .from('jobs')
    .select(`
      *,
      customers (*),
      fields (*),
      job_types (*),
      users (*),
      trucks (*),
      attachments (*)
    `)
    .eq('org_id', orgId)
    .eq('id', jobId)
    .single();
  handleError(error, 'Load job');
  return data;
}

export async function createJob(payload) {
  const job = await insertTable('jobs', payload);
  await startJobEvent(job.id, JOB_STATUSES.OPEN);
  return job;
}

export async function updateJob(id, payload) {
  return updateTable('jobs', id, payload);
}

export async function cancelJob(id, reason) {
  const payload = { status: JOB_STATUSES.CANCELED, canceled_at: new Date().toISOString(), canceled_reason: reason };
  const job = await updateTable('jobs', id, payload);
  await closeActiveEvent(id);
  return job;
}

export async function markJobInvoiced(id) {
  return updateTable('jobs', id, { status: JOB_STATUSES.INVOICED, invoiced_at: new Date().toISOString() });
}

async function closeActiveEvent(jobId) {
  const orgId = requireOrgId();
  const { data: activeEvents, error } = await getClient()
    .from('job_events')
    .select('*')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1);
  handleError(error, 'Load active job event');
  const active = activeEvents && activeEvents[0];
  if (!active) return;
  const endedAt = new Date();
  const durationSeconds = Math.max(0, Math.floor((endedAt - new Date(active.started_at)) / 1000));
  const { error: updateError } = await getClient()
    .from('job_events')
    .update({ ended_at: endedAt.toISOString(), duration_seconds: durationSeconds })
    .eq('id', active.id);
  handleError(updateError, 'Close job event');
}

async function startJobEvent(jobId, eventType, notes) {
  const orgId = requireOrgId();
  await closeActiveEvent(jobId);
  const { error } = await getClient()
    .from('job_events')
    .insert({ org_id: orgId, job_id: jobId, event_type: eventType, started_at: new Date().toISOString(), notes: notes || null });
  handleError(error, 'Start job event');
}

export async function setJobStatus(jobId, status, options = {}) {
  const payload = { status };
  if (status === JOB_STATUSES.FINISHED) {
    payload.finished_at = new Date().toISOString();
  }
  if (status === JOB_STATUSES.PAUSED && options.lastActiveStatus) {
    payload.last_active_status = options.lastActiveStatus;
  }
  const job = await updateTable('jobs', jobId, payload);
  if (status !== JOB_STATUSES.INVOICED && status !== JOB_STATUSES.CANCELED) {
    await startJobEvent(jobId, status, options.notes);
  }
  return job;
}

export async function getJobEvents(jobId) {
  const orgId = requireOrgId();
  const { data, error } = await getClient()
    .from('job_events')
    .select('*')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .order('started_at', { ascending: true });
  handleError(error, 'Load job events');
  return data || [];
}

export async function getJobStatusDurations(jobId) {
  const events = await getJobEvents(jobId);
  const totals = {};
  events.forEach((event) => {
    if (!event.duration_seconds) return;
    totals[event.event_type] = (totals[event.event_type] || 0) + event.duration_seconds;
  });
  return totals;
}

export async function listJobDiagnostics(jobId) {
  const orgId = requireOrgId();
  const { data, error } = await getClient()
    .from('job_diagnostics')
    .select('*')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  handleError(error, 'Load diagnostics');
  return data || [];
}

export async function addJobDiagnostic(payload) { return insertTable('job_diagnostics', payload); }
export async function deleteJobDiagnostic(id) { return deleteTable('job_diagnostics', id); }

export async function addJobRepair(payload) { return insertTable('job_repairs', payload); }

export async function listJobRepairs(jobId) {
  const orgId = requireOrgId();
  const { data, error } = await getClient()
    .from('job_repairs')
    .select('*')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  handleError(error, 'Load repairs');
  return data || [];
}

export async function addJobPart({ job_id, product_id, truck_id, qty }) {
  const orgId = requireOrgId();
  const { error } = await getClient().rpc('add_job_part', {
    p_org_id: orgId,
    p_job_id: job_id,
    p_product_id: product_id,
    p_truck_id: truck_id,
    p_qty: qty,
  });
  handleError(error, 'Add job part');
}

export async function removeJobPart({ job_part_id, truck_id }) {
  const orgId = requireOrgId();
  const { error } = await getClient().rpc('remove_job_part', {
    p_org_id: orgId,
    p_job_part_id: job_part_id,
    p_truck_id: truck_id,
  });
  handleError(error, 'Remove job part');
}

export async function listJobParts(jobId) {
  const orgId = requireOrgId();
  const { data, error } = await getClient()
    .from('job_parts')
    .select('*, products(*)')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  handleError(error, 'Load job parts');
  return data || [];
}

export async function listRequests(truckId) {
  const orgId = requireOrgId();
  const { data, error } = await getClient()
    .from('requests')
    .select('*, users(*)')
    .eq('org_id', orgId)
    .eq('truck_id', truckId)
    .order('created_at', { ascending: true });
  handleError(error, 'Load requests');
  return data || [];
}

export async function listAllRequests() {
  const orgId = requireOrgId();
  const { data, error } = await getClient()
    .from('requests')
    .select('*, users(*)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  handleError(error, 'Load requests');
  return data || [];
}

export async function listRequestHistory(userId) {
  const orgId = requireOrgId();
  let query = getClient()
    .from('request_history')
    .select('*, users(*)')
    .eq('org_id', orgId)
    .order('resolved_at', { ascending: false });
  if (userId) {
    query = query.eq('user_id', userId);
  }
  const { data, error } = await query;
  handleError(error, 'Load request history');
  return data || [];
}

export async function createRequest(payload) { return insertTable('requests', payload); }

export async function resolveRequest(requestId) {
  const { error } = await getClient().rpc('resolve_request', { p_request_id: requestId });
  handleError(error, 'Resolve request');
}

export async function listReceipts() {
  const orgId = requireOrgId();
  const { data, error } = await getClient()
    .from('receipts')
    .select('*, users(*), trucks(*)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  handleError(error, 'Load receipts');
  return data || [];
}
export async function createReceipt(payload) { return insertTable('receipts', payload); }
export async function deleteReceipt(id) { return deleteTable('receipts', id); }

export async function listOutOfStock() {
  const orgId = requireOrgId();
  const { data, error } = await getClient()
    .from('out_of_stock_flags')
    .select('*, products(*), trucks(*)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  handleError(error, 'Load out of stock');
  const flags = data || [];
  if (!flags.length) return flags;
  const truckIds = [...new Set(flags.map((flag) => flag.truck_id))];
  const productIds = [...new Set(flags.map((flag) => flag.product_id))];
  const { data: inventoryData, error: invError } = await getClient()
    .from('truck_inventory')
    .select('truck_id, product_id, qty')
    .eq('org_id', orgId)
    .in('truck_id', truckIds)
    .in('product_id', productIds);
  handleError(invError, 'Load out of stock inventory');
  const inventoryMap = new Map(
    (inventoryData || []).map((item) => [`${item.truck_id}:${item.product_id}`, item.qty])
  );
  return flags.map((flag) => ({
    ...flag,
    current_qty: inventoryMap.get(`${flag.truck_id}:${flag.product_id}`) || 0,
  }));
}
export async function createOutOfStock(payload) { return insertTable('out_of_stock_flags', payload); }
export async function deleteOutOfStock(id) { return deleteTable('out_of_stock_flags', id); }

export async function listAttachments(jobId) {
  const orgId = requireOrgId();
  const { data, error } = await getClient()
    .from('attachments')
    .select('*')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  handleError(error, 'Load attachments');
  return data || [];
}

export async function addAttachment(payload) { return insertTable('attachments', payload); }

export async function getRestockList(truckId) {
  const [products, inventory] = await Promise.all([
    listProducts(),
    listTruckInventory(truckId),
  ]);
  const inventoryMap = new Map(inventory.map((item) => [item.product_id, item.qty]));
  return products
    .map((product) => {
      const currentQty = inventoryMap.get(product.id) || 0;
      const neededQty = Math.max(0, product.minimum_qty - currentQty);
      return {
        product,
        currentQty,
        neededQty,
      };
    })
    .filter((entry) => entry.neededQty > 0)
    .sort((a, b) => a.product.name.localeCompare(b.product.name));
}

export async function commitRestock(truckId, restockItems) {
  const orgId = requireOrgId();
  for (const item of restockItems) {
    if (!item.acquiredQty || item.acquiredQty <= 0) continue;
    const { error } = await getClient()
      .from('truck_inventory')
      .upsert({
        org_id: orgId,
        truck_id: truckId,
        product_id: item.product.id,
        qty: item.currentQty + item.acquiredQty,
      }, { onConflict: 'truck_id,product_id' });
    handleError(error, 'Commit restock');
  }
}

export async function listJobReports(jobId) {
  const attachments = await listAttachments(jobId);
  return attachments.filter((item) => item.attachment_type.includes('report'));
}

export function getSupabaseClient() {
  return getClient();
}

export async function signIn(email, password) {
  const { data, error } = await getClient().auth.signInWithPassword({ email, password });
  handleError(error, 'Sign in');
  return data;
}

export async function signOut() {
  const { error } = await getClient().auth.signOut();
  handleError(error, 'Sign out');
}

export async function getSession() {
  const { data, error } = await getClient().auth.getSession();
  handleError(error, 'Get session');
  return data.session;
}
