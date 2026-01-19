import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { getConfig, DEFAULT_CONFIG } from './config.js';
import { JOB_STATUSES } from './types.js';

let client;
let jobStatusRpcSupported;


function getClient() {
  if (client) return client;
  const { supabaseUrl, supabaseAnonKey } = getConfig();
  const resolvedSupabaseUrl = supabaseUrl || DEFAULT_CONFIG.supabaseUrl;
  const resolvedSupabaseAnonKey = supabaseAnonKey || DEFAULT_CONFIG.supabaseAnonKey;
  if (!resolvedSupabaseUrl || !resolvedSupabaseAnonKey) {
    throw new Error('Supabase configuration missing. Please set SUPABASE_URL and SUPABASE_ANON_KEY.');
  }
  client = createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey);
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
async function checkJobStatusRpcSupport() {
  if (jobStatusRpcSupported !== undefined) return jobStatusRpcSupported;
 
  const { supabaseUrl, supabaseAnonKey } = getConfig();
  const resolvedSupabaseUrl = supabaseUrl || DEFAULT_CONFIG.supabaseUrl;
  const resolvedSupabaseAnonKey = supabaseAnonKey || DEFAULT_CONFIG.supabaseAnonKey;
  if (!resolvedSupabaseUrl || !resolvedSupabaseAnonKey) {
    jobStatusRpcSupported = false;
    return jobStatusRpcSupported;
  }
 jobStatusRpcSupported = true;
 return jobStatusRpcSupported;
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
export async function deleteProduct(id) {
  const { error } = await getClient().from('products').delete().eq('id', id);
  if (error?.code === '23503') {
    console.warn('Supabase delete blocked:', error);
    throw new Error('This product is linked to job parts. Remove those references before deleting.');
  }
  handleError(error, 'Delete products');
}

export async function uploadProductImage(file, options = {}) {
  const orgId = requireOrgId();
  const bucket = options.bucket || 'product-images';
  const prefix = options.prefix || 'products';
  const safeName = (file?.name || 'upload')
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]/g, '_');
  const path = `${orgId}/${prefix}/${Date.now()}_${Math.random().toString(16).slice(2)}_${safeName}`;
  const { error } = await getClient()
    .storage
    .from(bucket)
    .upload(path, file, { upsert: true });
  handleError(error, 'Upload product image');
  const { data } = getClient().storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || '';
}
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
export async function updateTruckTool(id, payload) { return updateTable('truck_tools', id, payload); }
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
  return (data || []).filter((item) => {
    if (item?.origin !== 'tech_added') return true;
    return Number(item?.qty ?? 0) > 0;
  });
}

export async function upsertTruckInventory({ truck_id, product_id, qty, min_qty, origin }) {
  const orgId = requireOrgId();
  const payload = { org_id: orgId, truck_id, product_id };
  if (qty !== undefined) payload.qty = qty;
  if (min_qty !== undefined) payload.min_qty = min_qty;
  if (origin !== undefined) payload.origin = origin;
  const { data, error } = await getClient()
    .from('truck_inventory')
    .upsert(payload, { onConflict: 'truck_id,product_id' })
    .select()
    .single();
  handleError(error, 'Update truck inventory');
  return data;
}

export async function updateTruckInventory(id, payload) { return updateTable('truck_inventory', id, payload);} 
export async function deleteTruckInventory(id) { return deleteTable('truck_inventory', id); }

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
    .is('ended_at', null)
    .order('started_at', { ascending: true });
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
      trucks (*)
    `)
    .eq('org_id', orgId)
    .eq('id', jobId)
    .single();
  handleError(error, 'Load job');
  return data;
}

export async function createJob(payload) {
  const orgId = requireOrgId();
  const data = await insertTable('jobs', {
    ...payload,
    status: payload.status || JOB_STATUSES.OPEN,
    org_id: orgId,
  });
  try {
    await setJobStatus(data.id, data.status, { notes: 'Created job' });
  } catch (error) {
    if (error.message?.includes('set_job_status')) {
      console.warn('Missing set_job_status RPC; skipping status event.', error);
    } else {
      throw error;
    }
  }
  return data;
}

export async function updateJob(id, payload) { return updateTable('jobs', id, payload); }

export async function cancelJob(id, reason) {
  const { error } = await getClient().rpc('cancel_job', { p_job_id: id, p_reason: reason });
  if (error?.code === 'PGRST202' && error.message?.includes('cancel_job')){
    await setJobStatus(id, JOB_STATUSES.CANCELED, { notes: reason });
    return;
  }
  handleError(error, 'Cancel job');
}

export async function markJobInvoiced(id) {
  const { error } = await getClient().rpc('mark_job_invoiced', { p_job_id: id });
  handleError(error, 'Mark invoiced');
}

export async function setJobStatus(jobId, status, options = {}) {
  const orgId = requireOrgId();
  const supportsRpc = await checkJobStatusRpcSupport();
  if (!supportsRpc) {
    await updateTable('jobs', jobId, { status });
    return;
  }
  const { error } = await getClient().rpc('set_job_status', {
    p_org_id: orgId,
    p_job_id: jobId,
    p_status: status,
    p_notes: options.notes,
    p_last_active_status: options.lastActiveStatus,
  });
  if (error?.code === 'PGRST202' && error.message?.includes('set_job_status')){
    jobStatusRpcSupported = false;
    await updateTable('jobs', jobId, {status });
      console.warn('Missing set-job_status RPC; skipping status event.', error);
    return;
  }
  handleError(error, 'Set job status');
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
export async function updateRequest(id, payload) { return updateTable('requests', id, payload); }
export async function deleteRequest(id) { return deleteTable('requests', id); }
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
export async function updateReceipt(id, payload) { return updateTable('receipts', id, payload); }
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
   const inventory = await listTruckInventory(truckId);
  return inventory
    .filter((item) => (item.origin || 'permanent') !== 'tech_added')
    .map((item) => {
      const product = item.products;
      if (!product) return null;
      const currentQty = Number(item.qty ?? 0);
      const minQty = Number(item.min_qty ?? product.minimum_qty ?? 0);
      const neededQty = Math.max(0, minQty - currentQty);
      return {
        product,
        currentQty,
        neededQty,
        minQty,
      };
    })
    .filter((entry) => entry && entry.neededQTY > 0)
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
    const currentOnHand = Number(item.product?.quantity_on_hand ?? item.product?.minimum_qty ?? 0);
    const newOnHand = Math.max(0, currentOnHand - item.acquiredQty);
    if (!Number.isNaN(newOnHand)) {
      await updateProduct(item.product.id, { quantity_on_hand: newOnHand });
    }
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
