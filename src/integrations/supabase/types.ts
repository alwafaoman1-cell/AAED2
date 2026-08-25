export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounting_account_mappings: {
        Row: {
          account_id: string
          business_type: string | null
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          department_id: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          mapping_key: string
          priority: number
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          business_type?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          mapping_key: string
          priority?: number
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          business_type?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          mapping_key?: string
          priority?: number
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_account_mappings_account_fk"
            columns: ["tenant_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounting_accounts"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_account_mappings_cost_center_fk"
            columns: ["tenant_id", "cost_center_id"]
            isOneToOne: false
            referencedRelation: "accounting_cost_centers"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_account_mappings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_accounts: {
        Row: {
          account_type: string
          code: string
          created_at: string
          created_by: string | null
          deactivated_at: string | null
          deactivated_by: string | null
          id: string
          is_active: boolean
          is_postable: boolean
          is_system: boolean
          level: number
          name_ar: string
          name_en: string
          normal_balance: string
          notes: string | null
          parent_id: string | null
          requires_cost_center: boolean
          requires_reconciliation: boolean
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_type: string
          code: string
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          id?: string
          is_active?: boolean
          is_postable?: boolean
          is_system?: boolean
          level?: number
          name_ar: string
          name_en: string
          normal_balance: string
          notes?: string | null
          parent_id?: string | null
          requires_cost_center?: boolean
          requires_reconciliation?: boolean
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_type?: string
          code?: string
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          id?: string
          is_active?: boolean
          is_postable?: boolean
          is_system?: boolean
          level?: number
          name_ar?: string
          name_en?: string
          normal_balance?: string
          notes?: string | null
          parent_id?: string | null
          requires_cost_center?: boolean
          requires_reconciliation?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_accounts_parent_tenant_fk"
            columns: ["tenant_id", "parent_id"]
            isOneToOne: false
            referencedRelation: "accounting_accounts"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_audit_logs: {
        Row: {
          action: string
          after_snapshot: Json | null
          before_snapshot: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          reason: string | null
          request_context: Json | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          after_snapshot?: Json | null
          before_snapshot?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          reason?: string | null
          request_context?: Json | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          after_snapshot?: Json | null
          before_snapshot?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          reason?: string | null
          request_context?: Json | null
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_cash_bank_accounts: {
        Row: {
          account_kind: string
          accounting_account_id: string
          bank_name: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          is_active: boolean
          is_default: boolean
          name_ar: string
          name_en: string
          reference_suffix: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_kind: string
          accounting_account_id: string
          bank_name?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name_ar: string
          name_en: string
          reference_suffix?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_kind?: string
          accounting_account_id?: string
          bank_name?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name_ar?: string
          name_en?: string
          reference_suffix?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_cash_bank_accounts_ledger_fk"
            columns: ["tenant_id", "accounting_account_id"]
            isOneToOne: false
            referencedRelation: "accounting_accounts"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_cash_bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_cost_centers: {
        Row: {
          branch_id: string | null
          code: string
          created_at: string
          created_by: string | null
          department_id: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          is_active: boolean
          is_system: boolean
          name_ar: string
          name_en: string
          parent_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          branch_id?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name_ar: string
          name_en: string
          parent_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          branch_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name_ar?: string
          name_en?: string
          parent_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_cost_centers_parent_tenant_fk"
            columns: ["tenant_id", "parent_id"]
            isOneToOne: false
            referencedRelation: "accounting_cost_centers"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_cost_centers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_fiscal_years: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          name: string
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          start_date: string
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          name: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          start_date: string
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          name?: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          start_date?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_fiscal_years_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_journal_entries: {
        Row: {
          accounting_date: string
          accounting_period_id: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          currency: string
          description_ar: string | null
          description_en: string | null
          document_date: string | null
          entry_number: string
          entry_type: string
          exchange_rate: number
          fiscal_year_id: string
          id: string
          posted_at: string | null
          posted_by: string | null
          reference: string | null
          reversal_reason: string | null
          reversed_entry_id: string | null
          source_identifier: string | null
          source_type: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          accounting_date: string
          accounting_period_id: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description_ar?: string | null
          description_en?: string | null
          document_date?: string | null
          entry_number: string
          entry_type?: string
          exchange_rate?: number
          fiscal_year_id: string
          id?: string
          posted_at?: string | null
          posted_by?: string | null
          reference?: string | null
          reversal_reason?: string | null
          reversed_entry_id?: string | null
          source_identifier?: string | null
          source_type?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          accounting_date?: string
          accounting_period_id?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description_ar?: string | null
          description_en?: string | null
          document_date?: string | null
          entry_number?: string
          entry_type?: string
          exchange_rate?: number
          fiscal_year_id?: string
          id?: string
          posted_at?: string | null
          posted_by?: string | null
          reference?: string | null
          reversal_reason?: string | null
          reversed_entry_id?: string | null
          source_identifier?: string | null
          source_type?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_journal_entries_period_fk"
            columns: ["tenant_id", "accounting_period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_journal_entries_reversed_fk"
            columns: ["tenant_id", "reversed_entry_id"]
            isOneToOne: false
            referencedRelation: "accounting_journal_entries"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_journal_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_journal_entries_year_fk"
            columns: ["tenant_id", "fiscal_year_id"]
            isOneToOne: false
            referencedRelation: "accounting_fiscal_years"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      accounting_journal_lines: {
        Row: {
          account_id: string
          claim_id: string | null
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          credit: number
          debit: number
          description: string | null
          expense_id: string | null
          id: string
          invoice_id: string | null
          journal_entry_id: string
          line_number: number
          party_id: string | null
          party_type: string | null
          payment_id: string | null
          reconciliation_reference: string | null
          tenant_id: string
          vehicle_id: string | null
          work_order_id: string | null
        }
        Insert: {
          account_id: string
          claim_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          credit?: number
          debit?: number
          description?: string | null
          expense_id?: string | null
          id?: string
          invoice_id?: string | null
          journal_entry_id: string
          line_number: number
          party_id?: string | null
          party_type?: string | null
          payment_id?: string | null
          reconciliation_reference?: string | null
          tenant_id: string
          vehicle_id?: string | null
          work_order_id?: string | null
        }
        Update: {
          account_id?: string
          claim_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          credit?: number
          debit?: number
          description?: string | null
          expense_id?: string | null
          id?: string
          invoice_id?: string | null
          journal_entry_id?: string
          line_number?: number
          party_id?: string | null
          party_type?: string | null
          payment_id?: string | null
          reconciliation_reference?: string | null
          tenant_id?: string
          vehicle_id?: string | null
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_journal_lines_account_fk"
            columns: ["tenant_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounting_accounts"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_journal_lines_cost_center_fk"
            columns: ["tenant_id", "cost_center_id"]
            isOneToOne: false
            referencedRelation: "accounting_cost_centers"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_journal_lines_entry_fk"
            columns: ["tenant_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "accounting_journal_entries"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_journal_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_journal_number_sequences: {
        Row: {
          fiscal_year_id: string
          next_value: number
          prefix: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          fiscal_year_id: string
          next_value?: number
          prefix?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          fiscal_year_id?: string
          next_value?: number
          prefix?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_journal_number_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_journal_sequence_year_fk"
            columns: ["tenant_id", "fiscal_year_id"]
            isOneToOne: true
            referencedRelation: "accounting_fiscal_years"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      accounting_opening_balance_batches: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          batch_number: string
          created_at: string
          created_by: string | null
          description: string | null
          fiscal_year_id: string
          id: string
          posted_at: string | null
          posted_by: string | null
          posting_journal_entry_id: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          batch_number: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          fiscal_year_id: string
          id?: string
          posted_at?: string | null
          posted_by?: string | null
          posting_journal_entry_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          batch_number?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          fiscal_year_id?: string
          id?: string
          posted_at?: string | null
          posted_by?: string | null
          posting_journal_entry_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_opening_balance_batches_journal_fk"
            columns: ["tenant_id", "posting_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "accounting_journal_entries"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_opening_balance_batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_opening_balance_batches_year_fk"
            columns: ["tenant_id", "fiscal_year_id"]
            isOneToOne: false
            referencedRelation: "accounting_fiscal_years"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      accounting_opening_balances: {
        Row: {
          account_id: string
          approved_at: string | null
          approved_by: string | null
          batch_id: string | null
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          credit: number
          debit: number
          fiscal_year_id: string
          id: string
          line_description: string | null
          posting_journal_entry_id: string | null
          source: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          account_id: string
          approved_at?: string | null
          approved_by?: string | null
          batch_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          credit?: number
          debit?: number
          fiscal_year_id: string
          id?: string
          line_description?: string | null
          posting_journal_entry_id?: string | null
          source?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          account_id?: string
          approved_at?: string | null
          approved_by?: string | null
          batch_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          credit?: number
          debit?: number
          fiscal_year_id?: string
          id?: string
          line_description?: string | null
          posting_journal_entry_id?: string | null
          source?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_opening_balances_account_fk"
            columns: ["tenant_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounting_accounts"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_opening_balances_batch_fk"
            columns: ["tenant_id", "batch_id"]
            isOneToOne: false
            referencedRelation: "accounting_opening_balance_batches"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_opening_balances_cost_center_fk"
            columns: ["tenant_id", "cost_center_id"]
            isOneToOne: false
            referencedRelation: "accounting_cost_centers"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_opening_balances_journal_fk"
            columns: ["tenant_id", "posting_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "accounting_journal_entries"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_opening_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_opening_balances_year_fk"
            columns: ["tenant_id", "fiscal_year_id"]
            isOneToOne: false
            referencedRelation: "accounting_fiscal_years"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      accounting_payment_method_mappings: {
        Row: {
          cash_bank_account_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          payment_method: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cash_bank_account_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          payment_method: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cash_bank_account_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          payment_method?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_payment_method_mappings_account_fk"
            columns: ["tenant_id", "cash_bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounting_cash_bank_accounts"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_payment_method_mappings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          end_date: string
          fiscal_year_id: string
          id: string
          name: string
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          sequence: number
          start_date: string
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          end_date: string
          fiscal_year_id: string
          id?: string
          name: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          sequence: number
          start_date: string
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string
          fiscal_year_id?: string
          id?: string
          name?: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          sequence?: number
          start_date?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_periods_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_periods_year_fk"
            columns: ["tenant_id", "fiscal_year_id"]
            isOneToOne: false
            referencedRelation: "accounting_fiscal_years"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      accounting_posting_requests: {
        Row: {
          accounting_date: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          error_code: string | null
          event_type: string
          id: string
          idempotency_key: string
          journal_entry_id: string | null
          preview_hash: string | null
          source_id: string
          source_type: string
          status: string
          tenant_id: string
        }
        Insert: {
          accounting_date: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_code?: string | null
          event_type: string
          id?: string
          idempotency_key: string
          journal_entry_id?: string | null
          preview_hash?: string | null
          source_id: string
          source_type: string
          status?: string
          tenant_id: string
        }
        Update: {
          accounting_date?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_code?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string
          journal_entry_id?: string | null
          preview_hash?: string | null
          source_id?: string
          source_type?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_posting_requests_journal_fk"
            columns: ["tenant_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "accounting_journal_entries"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_posting_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_posting_rules: {
        Row: {
          configuration: Json
          created_at: string
          created_by: string | null
          credit_mapping_key: string
          debit_mapping_key: string
          description_ar: string | null
          description_en: string | null
          effective_from: string | null
          effective_to: string | null
          event_type: string
          id: string
          is_active: boolean
          priority: number
          rule_key: string
          source_type: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          configuration?: Json
          created_at?: string
          created_by?: string | null
          credit_mapping_key: string
          debit_mapping_key: string
          description_ar?: string | null
          description_en?: string | null
          effective_from?: string | null
          effective_to?: string | null
          event_type: string
          id?: string
          is_active?: boolean
          priority?: number
          rule_key: string
          source_type: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          configuration?: Json
          created_at?: string
          created_by?: string | null
          credit_mapping_key?: string
          debit_mapping_key?: string
          description_ar?: string | null
          description_en?: string | null
          effective_from?: string | null
          effective_to?: string | null
          event_type?: string
          id?: string
          is_active?: boolean
          priority?: number
          rule_key?: string
          source_type?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_posting_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_receipts: {
        Row: {
          amount: number
          archived_at: string | null
          cashbox_id: string | null
          category_id: string | null
          claim_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          deleted_at: string | null
          id: string
          invoice_id: string | null
          notes: string | null
          payer_name: string
          payment_id: string | null
          payment_method: string
          receipt_date: string
          receipt_number: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          archived_at?: string | null
          cashbox_id?: string | null
          category_id?: string | null
          claim_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          payer_name?: string
          payment_id?: string | null
          payment_method?: string
          receipt_date?: string
          receipt_number: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          archived_at?: string | null
          cashbox_id?: string | null
          category_id?: string | null
          claim_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          payer_name?: string
          payment_id?: string | null
          payment_method?: string
          receipt_date?: string
          receipt_number?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_receipts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_report_saved_views: {
        Row: {
          columns: Json
          created_at: string
          filters: Json
          id: string
          name: string
          report_key: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          columns?: Json
          created_at?: string
          filters?: Json
          id?: string
          name: string
          report_key: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          columns?: Json
          created_at?: string
          filters?: Json
          id?: string
          name?: string
          report_key?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_report_saved_views_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_role_permissions: {
        Row: {
          created_at: string
          created_by: string | null
          granted: boolean
          id: string
          permission_key: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          granted?: boolean
          id?: string
          permission_key: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          granted?: boolean
          id?: string
          permission_key?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_role_permissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_source_links: {
        Row: {
          id: string
          is_primary: boolean
          journal_entry_id: string
          linked_at: string
          linked_by: string | null
          source_id: string
          source_number_snapshot: string | null
          source_status_snapshot: string | null
          source_type: string
          tenant_id: string
        }
        Insert: {
          id?: string
          is_primary?: boolean
          journal_entry_id: string
          linked_at?: string
          linked_by?: string | null
          source_id: string
          source_number_snapshot?: string | null
          source_status_snapshot?: string | null
          source_type: string
          tenant_id: string
        }
        Update: {
          id?: string
          is_primary?: boolean
          journal_entry_id?: string
          linked_at?: string
          linked_by?: string | null
          source_id?: string
          source_number_snapshot?: string | null
          source_status_snapshot?: string | null
          source_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_source_links_entry_fk"
            columns: ["tenant_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "accounting_journal_entries"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounting_source_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_notification_reads: {
        Row: {
          deleted_at: string | null
          notification_id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          deleted_at?: string | null
          notification_id: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          deleted_at?: string | null
          notification_id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_notification_reads_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "admin_notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          link: string | null
          sender_id: string
          sender_name: string | null
          tenant_id: string
          title: string
          type: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          link?: string | null
          sender_id: string
          sender_name?: string | null
          tenant_id: string
          title: string
          type?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          link?: string | null
          sender_id?: string
          sender_name?: string | null
          tenant_id?: string
          title?: string
          type?: string
        }
        Relationships: []
      }
      admin_user_events: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          details: Json
          id: string
          target_user_id: string | null
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_user_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_user_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_user_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_extraction_logs: {
        Row: {
          applied_fields_count: number
          created_at: string
          document_type: string | null
          extracted_fields_count: number
          failed_reason: string | null
          file_name: string | null
          file_type: string | null
          id: string
          processing_status: string
          provider: string | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          applied_fields_count?: number
          created_at?: string
          document_type?: string | null
          extracted_fields_count?: number
          failed_reason?: string | null
          file_name?: string | null
          file_type?: string | null
          id?: string
          processing_status?: string
          provider?: string | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          applied_fields_count?: number
          created_at?: string
          document_type?: string | null
          extracted_fields_count?: number
          failed_reason?: string | null
          file_name?: string | null
          file_type?: string | null
          id?: string
          processing_status?: string
          provider?: string | null
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      ai_usage_logs: {
        Row: {
          created_at: string
          document_type: string | null
          duration_ms: number | null
          error_message: string | null
          id: string
          model: string | null
          provider: string
          status: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          document_type?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          model?: string | null
          provider: string
          status?: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          document_type?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          model?: string | null
          provider?: string
          status?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      app_trash: {
        Row: {
          created_at: string
          deleted_at: string
          deleted_by: string | null
          entity_id: string
          entity_type: string
          id: string
          label: string
          metadata: Json
          payload: Json
          restore_status: string
          restored_at: string | null
          restored_by: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string
          deleted_by?: string | null
          entity_id: string
          entity_type: string
          id?: string
          label?: string
          metadata?: Json
          payload?: Json
          restore_status?: string
          restored_at?: string | null
          restored_by?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string
          deleted_by?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          label?: string
          metadata?: Json
          payload?: Json
          restore_status?: string
          restored_at?: string | null
          restored_by?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_trash_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      app_versions: {
        Row: {
          changelog: string | null
          created_at: string
          created_by: string | null
          grace_minutes: number
          id: string
          mandatory: boolean
          released_at: string
          tenant_id: string
          title: string | null
          updated_at: string
          version: string
        }
        Insert: {
          changelog?: string | null
          created_at?: string
          created_by?: string | null
          grace_minutes?: number
          id?: string
          mandatory?: boolean
          released_at?: string
          tenant_id: string
          title?: string | null
          updated_at?: string
          version: string
        }
        Update: {
          changelog?: string | null
          created_at?: string
          created_by?: string | null
          grace_minutes?: number
          id?: string
          mandatory?: boolean
          released_at?: string
          tenant_id?: string
          title?: string | null
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_audit_logs: {
        Row: {
          action: string
          category: string | null
          claim_id: string
          created_at: string
          details: Json | null
          file_path: string | null
          id: string
          tenant_id: string
          user_id: string | null
          vehicle_id: string | null
        }
        Insert: {
          action: string
          category?: string | null
          claim_id: string
          created_at?: string
          details?: Json | null
          file_path?: string | null
          id?: string
          tenant_id: string
          user_id?: string | null
          vehicle_id?: string | null
        }
        Update: {
          action?: string
          category?: string | null
          claim_id?: string
          created_at?: string
          details?: Json | null
          file_path?: string | null
          id?: string
          tenant_id?: string
          user_id?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_audit_logs_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_payments: {
        Row: {
          amount: number
          bank_name: string | null
          cheque_due_date: string | null
          claim_id: string
          created_at: string
          id: string
          insurance_company_id: string | null
          notes: string | null
          offset_against_invoice_id: string | null
          payment_date: string
          payment_method: Database["public"]["Enums"]["claim_payment_method"]
          payment_number: string
          reference_number: string | null
          status: Database["public"]["Enums"]["claim_payment_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          bank_name?: string | null
          cheque_due_date?: string | null
          claim_id: string
          created_at?: string
          id?: string
          insurance_company_id?: string | null
          notes?: string | null
          offset_against_invoice_id?: string | null
          payment_date?: string
          payment_method?: Database["public"]["Enums"]["claim_payment_method"]
          payment_number: string
          reference_number?: string | null
          status?: Database["public"]["Enums"]["claim_payment_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_name?: string | null
          cheque_due_date?: string | null
          claim_id?: string
          created_at?: string
          id?: string
          insurance_company_id?: string | null
          notes?: string | null
          offset_against_invoice_id?: string | null
          payment_date?: string
          payment_method?: Database["public"]["Enums"]["claim_payment_method"]
          payment_number?: string
          reference_number?: string | null
          status?: Database["public"]["Enums"]["claim_payment_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_payments_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "accounting_claims_summary_view"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "claim_payments_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims_archive_report"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "claim_payments_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "insurance_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_work_order_operations: {
        Row: {
          claim_id: string | null
          created_at: string
          customer_id: string | null
          estimate_ids: string[]
          id: string
          insurance_approval_status: string | null
          invoice_status: string | null
          last_changed_by: string | null
          last_changed_from: string | null
          operational_notes: string | null
          operational_status: string | null
          parts_required: Json
          payment_status: string | null
          repair_stage: string | null
          tenant_id: string
          updated_at: string
          vehicle_delivered_at: string | null
          vehicle_id: string | null
          vehicle_location_bay: string | null
          vehicle_location_note: string | null
          vehicle_location_section: string | null
          vehicle_location_updated_at: string | null
          vehicle_location_updated_by: string | null
          vehicle_presence_status: string | null
          vehicle_received_at: string | null
          work_completed_at: string | null
          work_order_id: string | null
          work_started_at: string | null
        }
        Insert: {
          claim_id?: string | null
          created_at?: string
          customer_id?: string | null
          estimate_ids?: string[]
          id?: string
          insurance_approval_status?: string | null
          invoice_status?: string | null
          last_changed_by?: string | null
          last_changed_from?: string | null
          operational_notes?: string | null
          operational_status?: string | null
          parts_required?: Json
          payment_status?: string | null
          repair_stage?: string | null
          tenant_id: string
          updated_at?: string
          vehicle_delivered_at?: string | null
          vehicle_id?: string | null
          vehicle_location_bay?: string | null
          vehicle_location_note?: string | null
          vehicle_location_section?: string | null
          vehicle_location_updated_at?: string | null
          vehicle_location_updated_by?: string | null
          vehicle_presence_status?: string | null
          vehicle_received_at?: string | null
          work_completed_at?: string | null
          work_order_id?: string | null
          work_started_at?: string | null
        }
        Update: {
          claim_id?: string | null
          created_at?: string
          customer_id?: string | null
          estimate_ids?: string[]
          id?: string
          insurance_approval_status?: string | null
          invoice_status?: string | null
          last_changed_by?: string | null
          last_changed_from?: string | null
          operational_notes?: string | null
          operational_status?: string | null
          parts_required?: Json
          payment_status?: string | null
          repair_stage?: string | null
          tenant_id?: string
          updated_at?: string
          vehicle_delivered_at?: string | null
          vehicle_id?: string | null
          vehicle_location_bay?: string | null
          vehicle_location_note?: string | null
          vehicle_location_section?: string | null
          vehicle_location_updated_at?: string | null
          vehicle_location_updated_by?: string | null
          vehicle_presence_status?: string | null
          vehicle_received_at?: string | null
          work_completed_at?: string | null
          work_order_id?: string | null
          work_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_work_order_operations_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "accounting_claims_summary_view"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "claim_work_order_operations_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims_archive_report"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "claim_work_order_operations_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "insurance_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_work_order_operations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_work_order_operations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_work_order_operations_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "claim_work_order_operations_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "claim_work_order_operations_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_work_order_operations_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_work_order_operations_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
        ]
      }
      cloud_reset_audit_log: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          requested_by: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          requested_by?: string | null
          status: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          requested_by?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloud_reset_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_advances: {
        Row: {
          amount: number
          applied_to_work_order_id: string | null
          cashbox_id: string | null
          cashbox_name: string | null
          consumed: number
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          date: string
          id: string
          job_order_id: string | null
          meta: Json
          notes: string | null
          payment_method: string
          receipt_number: string
          scope: string
          tenant_id: string
          updated_at: string
          vehicle_id: string | null
          vehicle_plate: string | null
        }
        Insert: {
          amount: number
          applied_to_work_order_id?: string | null
          cashbox_id?: string | null
          cashbox_name?: string | null
          consumed?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          date?: string
          id?: string
          job_order_id?: string | null
          meta?: Json
          notes?: string | null
          payment_method?: string
          receipt_number: string
          scope: string
          tenant_id: string
          updated_at?: string
          vehicle_id?: string | null
          vehicle_plate?: string | null
        }
        Update: {
          amount?: number
          applied_to_work_order_id?: string | null
          cashbox_id?: string | null
          cashbox_name?: string | null
          consumed?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          date?: string
          id?: string
          job_order_id?: string | null
          meta?: Json
          notes?: string | null
          payment_method?: string
          receipt_number?: string
          scope?: string
          tenant_id?: string
          updated_at?: string
          vehicle_id?: string | null
          vehicle_plate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_advances_applied_to_work_order_id_fkey"
            columns: ["applied_to_work_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "customer_advances_applied_to_work_order_id_fkey"
            columns: ["applied_to_work_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "customer_advances_applied_to_work_order_id_fkey"
            columns: ["applied_to_work_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_advances_applied_to_work_order_id_fkey"
            columns: ["applied_to_work_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_advances_applied_to_work_order_id_fkey"
            columns: ["applied_to_work_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "customer_advances_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_advances_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "customer_advances_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "customer_advances_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_advances_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_advances_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "customer_advances_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_feedback: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          job_order_id: string
          rating: number
          submitter_ip: string | null
          tenant_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          job_order_id: string
          rating: number
          submitter_ip?: string | null
          tenant_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          job_order_id?: string
          rating?: number
          submitter_ip?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_feedback_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: true
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "customer_feedback_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: true
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "customer_feedback_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: true
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_feedback_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: true
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_feedback_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: true
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
        ]
      }
      customer_notification_settings: {
        Row: {
          auto_send: boolean
          created_at: string
          default_channel: string
          enabled: boolean
          event_type: string
          id: string
          template_ar: string | null
          template_en: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          auto_send?: boolean
          created_at?: string
          default_channel?: string
          enabled?: boolean
          event_type: string
          id?: string
          template_ar?: string | null
          template_en?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          auto_send?: boolean
          created_at?: string
          default_channel?: string
          enabled?: boolean
          event_type?: string
          id?: string
          template_ar?: string | null
          template_en?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_notifications: {
        Row: {
          body: string
          channel: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          delivered_at: string | null
          error: string | null
          event_type: string
          id: string
          job_order_id: string | null
          payload: Json | null
          recipient: string | null
          sent_at: string | null
          status: string
          subject: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          body: string
          channel?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivered_at?: string | null
          error?: string | null
          event_type: string
          id?: string
          job_order_id?: string | null
          payload?: Json | null
          recipient?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivered_at?: string | null
          error?: string | null
          event_type?: string
          id?: string
          job_order_id?: string | null
          payload?: Json | null
          recipient?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_notifications_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "customer_notifications_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "customer_notifications_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notifications_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notifications_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
        ]
      }
      customer_portal_notes: {
        Row: {
          created_at: string
          customer_name: string | null
          id: string
          ip: string | null
          job_order_id: string
          note: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string
          tenant_id: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          customer_name?: string | null
          id?: string
          ip?: string | null
          job_order_id: string
          note: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          tenant_id: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          customer_name?: string | null
          id?: string
          ip?: string | null
          job_order_id?: string
          note?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          tenant_id?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_portal_notes_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "customer_portal_notes_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "customer_portal_notes_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_portal_notes_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_portal_notes_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
        ]
      }
      customer_portal_tokens: {
        Row: {
          created_at: string
          id: string
          job_order_id: string
          revoked_at: string | null
          signature_data_url: string | null
          signed_at: string | null
          signer_ip: string | null
          signer_name: string | null
          signer_user_agent: string | null
          tenant_id: string
          token: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_order_id: string
          revoked_at?: string | null
          signature_data_url?: string | null
          signed_at?: string | null
          signer_ip?: string | null
          signer_name?: string | null
          signer_user_agent?: string | null
          tenant_id: string
          token: string
        }
        Update: {
          created_at?: string
          id?: string
          job_order_id?: string
          revoked_at?: string | null
          signature_data_url?: string | null
          signed_at?: string | null
          signer_ip?: string | null
          signer_name?: string | null
          signer_user_agent?: string | null
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_portal_tokens_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: true
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "customer_portal_tokens_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: true
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "customer_portal_tokens_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: true
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_portal_tokens_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: true
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_portal_tokens_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: true
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          archived: boolean
          archived_at: string | null
          archived_reason: string | null
          buyer_type: string
          commercial_registration: string | null
          contact_person: string | null
          cr_number: string | null
          created_at: string
          customer_code: string | null
          deleted_at: string | null
          deleted_by: string | null
          email: string | null
          id: string
          id_number: string | null
          legal_name: string | null
          name: string
          notes: string | null
          phone: string | null
          tax_number: string | null
          tenant_id: string
          type: string
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          address?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_reason?: string | null
          buyer_type?: string
          commercial_registration?: string | null
          contact_person?: string | null
          cr_number?: string | null
          created_at?: string
          customer_code?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          id?: string
          id_number?: string | null
          legal_name?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          tax_number?: string | null
          tenant_id: string
          type?: string
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          address?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_reason?: string | null
          buyer_type?: string
          commercial_registration?: string | null
          contact_person?: string | null
          cr_number?: string | null
          created_at?: string
          customer_code?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          id?: string
          id_number?: string | null
          legal_name?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          tax_number?: string | null
          tenant_id?: string
          type?: string
          updated_at?: string
          vat_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string
          id: string
          priority: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string
          id?: string
          priority?: string
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string
          id?: string
          priority?: string
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      damage_markers: {
        Row: {
          created_at: string
          damage_type: string
          id: string
          inspection_id: string
          notes: string | null
          tenant_id: string
          x: number
          y: number
        }
        Insert: {
          created_at?: string
          damage_type?: string
          id?: string
          inspection_id: string
          notes?: string | null
          tenant_id: string
          x: number
          y: number
        }
        Update: {
          created_at?: string
          damage_type?: string
          id?: string
          inspection_id?: string
          notes?: string | null
          tenant_id?: string
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "damage_markers_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "damage_markers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_conversion_audit: {
        Row: {
          conversion_type: string
          converted_at: string
          converted_by: string | null
          created_at: string
          estimate_id: string
          existing_record_used: boolean
          id: string
          notes: string | null
          target_entity_id: string | null
          target_entity_type: string
          tenant_id: string
        }
        Insert: {
          conversion_type: string
          converted_at?: string
          converted_by?: string | null
          created_at?: string
          estimate_id: string
          existing_record_used?: boolean
          id?: string
          notes?: string | null
          target_entity_id?: string | null
          target_entity_type: string
          tenant_id: string
        }
        Update: {
          conversion_type?: string
          converted_at?: string
          converted_by?: string | null
          created_at?: string
          estimate_id?: string
          existing_record_used?: boolean
          id?: string
          notes?: string | null
          target_entity_id?: string | null
          target_entity_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_conversion_audit_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_items: {
        Row: {
          category: string
          created_at: string
          description_ar: string | null
          description_en: string | null
          estimate_id: string
          id: string
          line_subtotal: number
          line_total: number
          notes: string | null
          quantity: number
          sort_order: number
          tenant_id: string
          unit_price: number
          updated_at: string
          vat_amount: number
          vat_rate: number
        }
        Insert: {
          category?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          estimate_id: string
          id?: string
          line_subtotal?: number
          line_total?: number
          notes?: string | null
          quantity?: number
          sort_order?: number
          tenant_id: string
          unit_price?: number
          updated_at?: string
          vat_amount?: number
          vat_rate?: number
        }
        Update: {
          category?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          estimate_id?: string
          id?: string
          line_subtotal?: number
          line_total?: number
          notes?: string | null
          quantity?: number
          sort_order?: number
          tenant_id?: string
          unit_price?: number
          updated_at?: string
          vat_amount?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_items_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_sequences: {
        Row: {
          next_value: number
          tenant_id: string
          updated_at: string
          year: number
        }
        Insert: {
          next_value?: number
          tenant_id: string
          updated_at?: string
          year: number
        }
        Update: {
          next_value?: number
          tenant_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      estimates: {
        Row: {
          archived_at: string | null
          claim_id: string | null
          converted_at: string | null
          created_at: string
          created_by: string | null
          currency: string
          customer_id: string | null
          estimate_date: string
          estimate_number: string
          estimate_type: string
          id: string
          insurance_company_id: string | null
          insurance_employee_id: string | null
          internal_notes: string | null
          issued_at: string | null
          issued_by: string | null
          legacy_id: string | null
          legacy_number: string | null
          legacy_source: string | null
          notes: string | null
          parent_estimate_id: string | null
          purpose: string | null
          status: string
          subtotal: number
          tenant_id: string
          terms: string | null
          title: string | null
          total: number
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_enabled: boolean
          vat_rate: number
          vehicle_delivered_at: string | null
          vehicle_id: string | null
          vehicle_location_bay: string | null
          vehicle_location_note: string | null
          vehicle_location_section: string | null
          vehicle_presence_status: string
          vehicle_received_at: string | null
          work_order_id: string | null
          work_started_at: string | null
        }
        Insert: {
          archived_at?: string | null
          claim_id?: string | null
          converted_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
          estimate_date?: string
          estimate_number: string
          estimate_type?: string
          id?: string
          insurance_company_id?: string | null
          insurance_employee_id?: string | null
          internal_notes?: string | null
          issued_at?: string | null
          issued_by?: string | null
          legacy_id?: string | null
          legacy_number?: string | null
          legacy_source?: string | null
          notes?: string | null
          parent_estimate_id?: string | null
          purpose?: string | null
          status?: string
          subtotal?: number
          tenant_id: string
          terms?: string | null
          title?: string | null
          total?: number
          updated_at?: string
          valid_until?: string | null
          vat_amount?: number
          vat_enabled?: boolean
          vat_rate?: number
          vehicle_delivered_at?: string | null
          vehicle_id?: string | null
          vehicle_location_bay?: string | null
          vehicle_location_note?: string | null
          vehicle_location_section?: string | null
          vehicle_presence_status?: string
          vehicle_received_at?: string | null
          work_order_id?: string | null
          work_started_at?: string | null
        }
        Update: {
          archived_at?: string | null
          claim_id?: string | null
          converted_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
          estimate_date?: string
          estimate_number?: string
          estimate_type?: string
          id?: string
          insurance_company_id?: string | null
          insurance_employee_id?: string | null
          internal_notes?: string | null
          issued_at?: string | null
          issued_by?: string | null
          legacy_id?: string | null
          legacy_number?: string | null
          legacy_source?: string | null
          notes?: string | null
          parent_estimate_id?: string | null
          purpose?: string | null
          status?: string
          subtotal?: number
          tenant_id?: string
          terms?: string | null
          title?: string | null
          total?: number
          updated_at?: string
          valid_until?: string | null
          vat_amount?: number
          vat_enabled?: boolean
          vat_rate?: number
          vehicle_delivered_at?: string | null
          vehicle_id?: string | null
          vehicle_location_bay?: string | null
          vehicle_location_note?: string | null
          vehicle_location_section?: string | null
          vehicle_presence_status?: string
          vehicle_received_at?: string | null
          work_order_id?: string | null
          work_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimates_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "accounting_claims_summary_view"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "estimates_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims_archive_report"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "estimates_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "insurance_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_parent_estimate_id_fkey"
            columns: ["parent_estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "estimates_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "estimates_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          accounting_mapping_key: string | null
          active: boolean
          category_type: string | null
          code: string | null
          color: string | null
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          department_code: string | null
          description: string | null
          description_ar: string | null
          description_en: string | null
          expense_scope: string | null
          id: string
          is_active: boolean | null
          is_system: boolean
          level: number | null
          name: string
          name_ar: string | null
          name_en: string | null
          parent_id: string | null
          sort_order: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          accounting_mapping_key?: string | null
          active?: boolean
          category_type?: string | null
          code?: string | null
          color?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          department_code?: string | null
          description?: string | null
          description_ar?: string | null
          description_en?: string | null
          expense_scope?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean
          level?: number | null
          name: string
          name_ar?: string | null
          name_en?: string | null
          parent_id?: string | null
          sort_order?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          accounting_mapping_key?: string | null
          active?: boolean
          category_type?: string | null
          code?: string | null
          color?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          department_code?: string | null
          description?: string | null
          description_ar?: string | null
          description_en?: string | null
          expense_scope?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean
          level?: number | null
          name?: string
          name_ar?: string | null
          name_en?: string | null
          parent_id?: string | null
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_cost_center_fk"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "accounting_cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_categories_parent_fk"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_category_audit_logs: {
        Row: {
          action: string
          category_id: string
          created_at: string
          id: string
          new_value: Json | null
          old_value: Json | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          category_id: string
          created_at?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          category_id?: string
          created_at?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      expense_category_template_items: {
        Row: {
          accounting_mapping_key: string | null
          category_type: string
          code: string
          expense_scope: string
          name_ar: string
          name_en: string
          parent_code: string | null
          sort_order: number
        }
        Insert: {
          accounting_mapping_key?: string | null
          category_type: string
          code: string
          expense_scope: string
          name_ar: string
          name_en: string
          parent_code?: string | null
          sort_order?: number
        }
        Update: {
          accounting_mapping_key?: string | null
          category_type?: string
          code?: string
          expense_scope?: string
          name_ar?: string
          name_en?: string
          parent_code?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      expense_voucher_sequences: {
        Row: {
          last_number: number
          prefix: string
          tenant_id: string
          updated_at: string
          voucher_year: number
        }
        Insert: {
          last_number: number
          prefix: string
          tenant_id: string
          updated_at?: string
          voucher_year: number
        }
        Update: {
          last_number?: number
          prefix?: string
          tenant_id?: string
          updated_at?: string
          voucher_year?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_voucher_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          accounting_mapping_key: string | null
          amount: number
          archived_at: string | null
          attachments: Json
          beneficiary: string | null
          cashbox_id: string | null
          cashbox_name: string | null
          category_id: string | null
          category_name: string | null
          claim_id: string | null
          classification_status: string | null
          cost_center: string
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          date: string
          deleted_at: string | null
          deleted_by: string | null
          department_id: string | null
          description: string | null
          expense_category_id: string | null
          expense_scope: string | null
          expense_type: string
          id: string
          invoice_id: string | null
          is_vat_applicable: boolean
          linked_vehicle_name: string | null
          linked_vehicle_plate: string | null
          linked_work_order_id: string | null
          meta: Json
          notes: string | null
          payment_method: string
          reference_number: string | null
          status: string | null
          subcategory_id: string | null
          subtotal: number
          supplier_id: string | null
          supplier_invoice_date: string | null
          supplier_invoice_number: string | null
          supplier_tax_number: string | null
          tenant_id: string
          total: number
          updated_at: string
          vat_amount: number
          vehicle_id: string | null
          voucher_number: string
          voucher_number_guarded: boolean | null
          work_order_channel: string | null
          work_order_id: string | null
        }
        Insert: {
          accounting_mapping_key?: string | null
          amount?: number
          archived_at?: string | null
          attachments?: Json
          beneficiary?: string | null
          cashbox_id?: string | null
          cashbox_name?: string | null
          category_id?: string | null
          category_name?: string | null
          claim_id?: string | null
          classification_status?: string | null
          cost_center?: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          date?: string
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string | null
          description?: string | null
          expense_category_id?: string | null
          expense_scope?: string | null
          expense_type?: string
          id?: string
          invoice_id?: string | null
          is_vat_applicable?: boolean
          linked_vehicle_name?: string | null
          linked_vehicle_plate?: string | null
          linked_work_order_id?: string | null
          meta?: Json
          notes?: string | null
          payment_method?: string
          reference_number?: string | null
          status?: string | null
          subcategory_id?: string | null
          subtotal?: number
          supplier_id?: string | null
          supplier_invoice_date?: string | null
          supplier_invoice_number?: string | null
          supplier_tax_number?: string | null
          tenant_id: string
          total?: number
          updated_at?: string
          vat_amount?: number
          vehicle_id?: string | null
          voucher_number: string
          voucher_number_guarded?: boolean | null
          work_order_channel?: string | null
          work_order_id?: string | null
        }
        Update: {
          accounting_mapping_key?: string | null
          amount?: number
          archived_at?: string | null
          attachments?: Json
          beneficiary?: string | null
          cashbox_id?: string | null
          cashbox_name?: string | null
          category_id?: string | null
          category_name?: string | null
          claim_id?: string | null
          classification_status?: string | null
          cost_center?: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          date?: string
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string | null
          description?: string | null
          expense_category_id?: string | null
          expense_scope?: string | null
          expense_type?: string
          id?: string
          invoice_id?: string | null
          is_vat_applicable?: boolean
          linked_vehicle_name?: string | null
          linked_vehicle_plate?: string | null
          linked_work_order_id?: string | null
          meta?: Json
          notes?: string | null
          payment_method?: string
          reference_number?: string | null
          status?: string | null
          subcategory_id?: string | null
          subtotal?: number
          supplier_id?: string | null
          supplier_invoice_date?: string | null
          supplier_invoice_number?: string | null
          supplier_tax_number?: string | null
          tenant_id?: string
          total?: number
          updated_at?: string
          vat_amount?: number
          vehicle_id?: string | null
          voucher_number?: string
          voucher_number_guarded?: boolean | null
          work_order_channel?: string | null
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "accounting_claims_summary_view"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "expenses_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims_archive_report"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "expenses_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "insurance_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_cost_center_fk"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "accounting_cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_department_category_fk"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_expense_category_fk"
            columns: ["expense_category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_subcategory_fk"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_work_order_uuid_fk"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "expenses_work_order_uuid_fk"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "expenses_work_order_uuid_fk"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_work_order_uuid_fk"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_work_order_uuid_fk"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
        ]
      }
      import_export_operations: {
        Row: {
          created_at: string
          created_by: string | null
          duplicate_count: number
          entity: string
          error_count: number
          id: string
          metadata: Json
          operation: string
          row_count: number
          status: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          duplicate_count?: number
          entity: string
          error_count?: number
          id?: string
          metadata?: Json
          operation: string
          row_count?: number
          status?: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          duplicate_count?: number
          entity?: string
          error_count?: number
          id?: string
          metadata?: Json
          operation?: string
          row_count?: number
          status?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      inspections: {
        Row: {
          ai_analysis: Json | null
          ai_analysis_status: string
          ai_analyzed_at: string | null
          computer_report_path: string | null
          created_at: string
          customer_name: string | null
          damage_type: string | null
          details: Json
          id: string
          inspection_code: string | null
          inspection_date: string
          inspection_kind: string
          inspector_id: string | null
          job_order_id: string | null
          notes: string | null
          overall_rating: string | null
          photo_count: number
          photos: string[] | null
          plate_number: string | null
          status: string
          tenant_id: string
          updated_at: string
          vehicle_summary: string | null
        }
        Insert: {
          ai_analysis?: Json | null
          ai_analysis_status?: string
          ai_analyzed_at?: string | null
          computer_report_path?: string | null
          created_at?: string
          customer_name?: string | null
          damage_type?: string | null
          details?: Json
          id?: string
          inspection_code?: string | null
          inspection_date?: string
          inspection_kind?: string
          inspector_id?: string | null
          job_order_id?: string | null
          notes?: string | null
          overall_rating?: string | null
          photo_count?: number
          photos?: string[] | null
          plate_number?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          vehicle_summary?: string | null
        }
        Update: {
          ai_analysis?: Json | null
          ai_analysis_status?: string
          ai_analyzed_at?: string | null
          computer_report_path?: string | null
          created_at?: string
          customer_name?: string | null
          damage_type?: string | null
          details?: Json
          id?: string
          inspection_code?: string | null
          inspection_date?: string
          inspection_kind?: string
          inspector_id?: string | null
          job_order_id?: string | null
          notes?: string | null
          overall_rating?: string | null
          photo_count?: number
          photos?: string[] | null
          plate_number?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          vehicle_summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspections_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "inspections_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "inspections_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "inspections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_claims: {
        Row: {
          adjuster_name: string | null
          adjuster_phone: string | null
          approved_amount: number | null
          approved_at: string | null
          auto_job_order_id: string | null
          claim_number: string
          claim_registered_at: string | null
          created_at: string
          customer_id: string
          damage_photos: string[] | null
          deductible_amount: number | null
          deleted_at: string | null
          delivered_at: string | null
          delivery_notes: string | null
          delivery_photos: string[] | null
          documents: Json | null
          estimate_date: string | null
          estimated_amount: number
          estimated_cost: number | null
          estimation_type: string
          id: string
          incident_date: string | null
          incident_description: string | null
          incident_location: string | null
          inspection_at: string | null
          inspection_id: string | null
          insurance_approved_at: string | null
          insurance_company: string
          insurance_company_id: string | null
          insurance_employee_id: string | null
          invoice_collected_at: string | null
          job_order_id: string | null
          lpo_amount: number | null
          lpo_date: string | null
          lpo_file_name: string | null
          lpo_file_url: string | null
          lpo_followup_method: string | null
          lpo_followup_note: string | null
          lpo_number: string | null
          lpo_received_at: string | null
          lpo_requested_at: string | null
          lpo_requested_by: string | null
          needed_parts: Json | null
          notes: string | null
          paid_at: string | null
          policy_expiry_date: string | null
          policy_number: string | null
          quality_checked_at: string | null
          received_at: string | null
          receiver_id_number: string | null
          receiver_id_photo: string | null
          receiver_name: string | null
          rejection_reason: string | null
          repair_stage: string | null
          repair_started_at: string | null
          replacement_vehicle_approved_days: number | null
          replacement_vehicle_benefit_start_at: string | null
          replacement_vehicle_daily_amount: number | null
          replacement_vehicle_insurance_company: string | null
          replacement_vehicle_insurance_note: string | null
          replacement_vehicle_policy_includes: boolean | null
          replacement_vehicle_request_type: string | null
          replacement_vehicle_requested: boolean | null
          replacement_vehicle_requested_at: string | null
          replacement_vehicle_required_documents: string | null
          replacement_vehicle_responsible_employee: string | null
          replacement_vehicle_status: string | null
          satisfaction_photos: string[] | null
          source_estimate_id: string | null
          status: Database["public"]["Enums"]["claim_status"]
          tenant_id: string
          updated_at: string
          upl_items: Json | null
          vehicle_color: string | null
          vehicle_delivered_at: string | null
          vehicle_entry_id: string | null
          vehicle_id: string | null
          vehicle_location_bay: string | null
          vehicle_location_note: string | null
          vehicle_location_section: string | null
          vehicle_location_updated_at: string | null
          vehicle_location_updated_by: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_owner_name: string | null
          vehicle_owner_phone: string | null
          vehicle_plate: string | null
          vehicle_presence_status: string
          vehicle_received_at: string | null
          vehicle_stay_alert_excluded: boolean | null
          vehicle_stay_delay_reason: string | null
          vehicle_stay_last_contact_at: string | null
          vehicle_vin: string | null
          vehicle_year: number | null
          work_completed_at: string | null
          work_started_at: string | null
          workshop_arrival_date: string | null
        }
        Insert: {
          adjuster_name?: string | null
          adjuster_phone?: string | null
          approved_amount?: number | null
          approved_at?: string | null
          auto_job_order_id?: string | null
          claim_number: string
          claim_registered_at?: string | null
          created_at?: string
          customer_id: string
          damage_photos?: string[] | null
          deductible_amount?: number | null
          deleted_at?: string | null
          delivered_at?: string | null
          delivery_notes?: string | null
          delivery_photos?: string[] | null
          documents?: Json | null
          estimate_date?: string | null
          estimated_amount?: number
          estimated_cost?: number | null
          estimation_type?: string
          id?: string
          incident_date?: string | null
          incident_description?: string | null
          incident_location?: string | null
          inspection_at?: string | null
          inspection_id?: string | null
          insurance_approved_at?: string | null
          insurance_company: string
          insurance_company_id?: string | null
          insurance_employee_id?: string | null
          invoice_collected_at?: string | null
          job_order_id?: string | null
          lpo_amount?: number | null
          lpo_date?: string | null
          lpo_file_name?: string | null
          lpo_file_url?: string | null
          lpo_followup_method?: string | null
          lpo_followup_note?: string | null
          lpo_number?: string | null
          lpo_received_at?: string | null
          lpo_requested_at?: string | null
          lpo_requested_by?: string | null
          needed_parts?: Json | null
          notes?: string | null
          paid_at?: string | null
          policy_expiry_date?: string | null
          policy_number?: string | null
          quality_checked_at?: string | null
          received_at?: string | null
          receiver_id_number?: string | null
          receiver_id_photo?: string | null
          receiver_name?: string | null
          rejection_reason?: string | null
          repair_stage?: string | null
          repair_started_at?: string | null
          replacement_vehicle_approved_days?: number | null
          replacement_vehicle_benefit_start_at?: string | null
          replacement_vehicle_daily_amount?: number | null
          replacement_vehicle_insurance_company?: string | null
          replacement_vehicle_insurance_note?: string | null
          replacement_vehicle_policy_includes?: boolean | null
          replacement_vehicle_request_type?: string | null
          replacement_vehicle_requested?: boolean | null
          replacement_vehicle_requested_at?: string | null
          replacement_vehicle_required_documents?: string | null
          replacement_vehicle_responsible_employee?: string | null
          replacement_vehicle_status?: string | null
          satisfaction_photos?: string[] | null
          source_estimate_id?: string | null
          status?: Database["public"]["Enums"]["claim_status"]
          tenant_id: string
          updated_at?: string
          upl_items?: Json | null
          vehicle_color?: string | null
          vehicle_delivered_at?: string | null
          vehicle_entry_id?: string | null
          vehicle_id?: string | null
          vehicle_location_bay?: string | null
          vehicle_location_note?: string | null
          vehicle_location_section?: string | null
          vehicle_location_updated_at?: string | null
          vehicle_location_updated_by?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_owner_name?: string | null
          vehicle_owner_phone?: string | null
          vehicle_plate?: string | null
          vehicle_presence_status?: string
          vehicle_received_at?: string | null
          vehicle_stay_alert_excluded?: boolean | null
          vehicle_stay_delay_reason?: string | null
          vehicle_stay_last_contact_at?: string | null
          vehicle_vin?: string | null
          vehicle_year?: number | null
          work_completed_at?: string | null
          work_started_at?: string | null
          workshop_arrival_date?: string | null
        }
        Update: {
          adjuster_name?: string | null
          adjuster_phone?: string | null
          approved_amount?: number | null
          approved_at?: string | null
          auto_job_order_id?: string | null
          claim_number?: string
          claim_registered_at?: string | null
          created_at?: string
          customer_id?: string
          damage_photos?: string[] | null
          deductible_amount?: number | null
          deleted_at?: string | null
          delivered_at?: string | null
          delivery_notes?: string | null
          delivery_photos?: string[] | null
          documents?: Json | null
          estimate_date?: string | null
          estimated_amount?: number
          estimated_cost?: number | null
          estimation_type?: string
          id?: string
          incident_date?: string | null
          incident_description?: string | null
          incident_location?: string | null
          inspection_at?: string | null
          inspection_id?: string | null
          insurance_approved_at?: string | null
          insurance_company?: string
          insurance_company_id?: string | null
          insurance_employee_id?: string | null
          invoice_collected_at?: string | null
          job_order_id?: string | null
          lpo_amount?: number | null
          lpo_date?: string | null
          lpo_file_name?: string | null
          lpo_file_url?: string | null
          lpo_followup_method?: string | null
          lpo_followup_note?: string | null
          lpo_number?: string | null
          lpo_received_at?: string | null
          lpo_requested_at?: string | null
          lpo_requested_by?: string | null
          needed_parts?: Json | null
          notes?: string | null
          paid_at?: string | null
          policy_expiry_date?: string | null
          policy_number?: string | null
          quality_checked_at?: string | null
          received_at?: string | null
          receiver_id_number?: string | null
          receiver_id_photo?: string | null
          receiver_name?: string | null
          rejection_reason?: string | null
          repair_stage?: string | null
          repair_started_at?: string | null
          replacement_vehicle_approved_days?: number | null
          replacement_vehicle_benefit_start_at?: string | null
          replacement_vehicle_daily_amount?: number | null
          replacement_vehicle_insurance_company?: string | null
          replacement_vehicle_insurance_note?: string | null
          replacement_vehicle_policy_includes?: boolean | null
          replacement_vehicle_request_type?: string | null
          replacement_vehicle_requested?: boolean | null
          replacement_vehicle_requested_at?: string | null
          replacement_vehicle_required_documents?: string | null
          replacement_vehicle_responsible_employee?: string | null
          replacement_vehicle_status?: string | null
          satisfaction_photos?: string[] | null
          source_estimate_id?: string | null
          status?: Database["public"]["Enums"]["claim_status"]
          tenant_id?: string
          updated_at?: string
          upl_items?: Json | null
          vehicle_color?: string | null
          vehicle_delivered_at?: string | null
          vehicle_entry_id?: string | null
          vehicle_id?: string | null
          vehicle_location_bay?: string | null
          vehicle_location_note?: string | null
          vehicle_location_section?: string | null
          vehicle_location_updated_at?: string | null
          vehicle_location_updated_by?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_owner_name?: string | null
          vehicle_owner_phone?: string | null
          vehicle_plate?: string | null
          vehicle_presence_status?: string
          vehicle_received_at?: string | null
          vehicle_stay_alert_excluded?: boolean | null
          vehicle_stay_delay_reason?: string | null
          vehicle_stay_last_contact_at?: string | null
          vehicle_vin?: string | null
          vehicle_year?: number | null
          work_completed_at?: string | null
          work_started_at?: string | null
          workshop_arrival_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurance_claims_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_insurance_employee_id_fkey"
            columns: ["insurance_employee_id"]
            isOneToOne: false
            referencedRelation: "insurance_company_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "insurance_claims_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "insurance_claims_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "insurance_claims_source_estimate_id_fkey"
            columns: ["source_estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_vehicle_entry_id_fkey"
            columns: ["vehicle_entry_id"]
            isOneToOne: false
            referencedRelation: "vehicle_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_companies: {
        Row: {
          address: string | null
          bank_account_name: string | null
          bank_name: string | null
          branch_city: string | null
          commercial_registration: string | null
          contact_person: string | null
          cr_number: string | null
          created_at: string
          default_deductible_percent: number
          email: string | null
          iban: string | null
          id: string
          is_active: boolean
          legal_name: string | null
          logo_url: string | null
          name: string
          notes: string | null
          payment_terms_days: number
          phone: string | null
          po_box: string | null
          tax_number: string | null
          tenant_id: string
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          address?: string | null
          bank_account_name?: string | null
          bank_name?: string | null
          branch_city?: string | null
          commercial_registration?: string | null
          contact_person?: string | null
          cr_number?: string | null
          created_at?: string
          default_deductible_percent?: number
          email?: string | null
          iban?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          logo_url?: string | null
          name: string
          notes?: string | null
          payment_terms_days?: number
          phone?: string | null
          po_box?: string | null
          tax_number?: string | null
          tenant_id: string
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          address?: string | null
          bank_account_name?: string | null
          bank_name?: string | null
          branch_city?: string | null
          commercial_registration?: string | null
          contact_person?: string | null
          cr_number?: string | null
          created_at?: string
          default_deductible_percent?: number
          email?: string | null
          iban?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          logo_url?: string | null
          name?: string
          notes?: string | null
          payment_terms_days?: number
          phone?: string | null
          po_box?: string | null
          tax_number?: string | null
          tenant_id?: string
          updated_at?: string
          vat_number?: string | null
        }
        Relationships: []
      }
      insurance_company_employees: {
        Row: {
          created_at: string
          email: string | null
          id: string
          insurance_company_id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          tenant_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          insurance_company_id: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          tenant_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          insurance_company_id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insurance_company_employees_insurance_company_id_fkey"
            columns: ["insurance_company_id"]
            isOneToOne: false
            referencedRelation: "insurance_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_estimates: {
        Row: {
          claim_number: string | null
          converted_at: string | null
          converted_claim_id: string | null
          created_at: string
          created_by: string | null
          customer_name: string | null
          customer_phone: string | null
          damage_photos: string[] | null
          deductible_amount: number
          estimate_number: string
          estimation_type: string
          id: string
          incident_date: string | null
          incident_description: string | null
          insurance_company: string | null
          insurance_company_id: string | null
          lump_sum_amount: number
          notes: string | null
          status: string
          tenant_id: string
          terms_text: string | null
          updated_at: string
          upl_items: Json
          vehicle_color: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_plate: string | null
          vehicle_year: number | null
        }
        Insert: {
          claim_number?: string | null
          converted_at?: string | null
          converted_claim_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          damage_photos?: string[] | null
          deductible_amount?: number
          estimate_number: string
          estimation_type?: string
          id?: string
          incident_date?: string | null
          incident_description?: string | null
          insurance_company?: string | null
          insurance_company_id?: string | null
          lump_sum_amount?: number
          notes?: string | null
          status?: string
          tenant_id: string
          terms_text?: string | null
          updated_at?: string
          upl_items?: Json
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_plate?: string | null
          vehicle_year?: number | null
        }
        Update: {
          claim_number?: string | null
          converted_at?: string | null
          converted_claim_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          damage_photos?: string[] | null
          deductible_amount?: number
          estimate_number?: string
          estimation_type?: string
          id?: string
          incident_date?: string | null
          incident_description?: string | null
          insurance_company?: string | null
          insurance_company_id?: string | null
          lump_sum_amount?: number
          notes?: string | null
          status?: string
          tenant_id?: string
          terms_text?: string | null
          updated_at?: string
          upl_items?: Json
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_plate?: string | null
          vehicle_year?: number | null
        }
        Relationships: []
      }
      insurance_invoices: {
        Row: {
          claim_id: string
          created_at: string
          due_date: string | null
          id: string
          idempotency_key: string | null
          insurance_company_id: string | null
          insurance_company_name: string
          invoice_date: string | null
          invoice_number: string
          issued_at: string
          items: Json
          last_payment_date: string | null
          lpo_number: string | null
          notes: string | null
          paid_amount: number
          pdf_url: string | null
          secure_token: string | null
          status: string
          subtotal: number
          tenant_id: string
          token_revoked_at: string | null
          total: number
          updated_at: string
          vat: number
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_plate: string | null
          vehicle_vin: string | null
        }
        Insert: {
          claim_id: string
          created_at?: string
          due_date?: string | null
          id?: string
          idempotency_key?: string | null
          insurance_company_id?: string | null
          insurance_company_name: string
          invoice_date?: string | null
          invoice_number: string
          issued_at?: string
          items?: Json
          last_payment_date?: string | null
          lpo_number?: string | null
          notes?: string | null
          paid_amount?: number
          pdf_url?: string | null
          secure_token?: string | null
          status?: string
          subtotal?: number
          tenant_id: string
          token_revoked_at?: string | null
          total?: number
          updated_at?: string
          vat?: number
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_plate?: string | null
          vehicle_vin?: string | null
        }
        Update: {
          claim_id?: string
          created_at?: string
          due_date?: string | null
          id?: string
          idempotency_key?: string | null
          insurance_company_id?: string | null
          insurance_company_name?: string
          invoice_date?: string | null
          invoice_number?: string
          issued_at?: string
          items?: Json
          last_payment_date?: string | null
          lpo_number?: string | null
          notes?: string | null
          paid_amount?: number
          pdf_url?: string | null
          secure_token?: string | null
          status?: string
          subtotal?: number
          tenant_id?: string
          token_revoked_at?: string | null
          total?: number
          updated_at?: string
          vat?: number
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_plate?: string | null
          vehicle_vin?: string | null
        }
        Relationships: []
      }
      inventory: {
        Row: {
          barcode: string | null
          category: string | null
          cost_price: number
          created_at: string
          id: string
          location: string | null
          min_quantity: number
          name: string
          notes: string | null
          part_number: string | null
          quantity: number
          supplier_id: string | null
          tenant_id: string
          unit: string | null
          unit_price: number
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          category?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          location?: string | null
          min_quantity?: number
          name: string
          notes?: string | null
          part_number?: string | null
          quantity?: number
          supplier_id?: string | null
          tenant_id: string
          unit?: string | null
          unit_price?: number
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          category?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          location?: string | null
          min_quantity?: number
          name?: string
          notes?: string | null
          part_number?: string | null
          quantity?: number
          supplier_id?: string | null
          tenant_id?: string
          unit?: string | null
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_number_audit_events: {
        Row: {
          details: Json
          event_at: string
          event_by: string | null
          event_type: string
          id: string
          invoice_number: string
          registry_id: string
          source_id: string
          source_table: string
          tenant_id: string
        }
        Insert: {
          details?: Json
          event_at?: string
          event_by?: string | null
          event_type: string
          id?: string
          invoice_number: string
          registry_id: string
          source_id: string
          source_table: string
          tenant_id: string
        }
        Update: {
          details?: Json
          event_at?: string
          event_by?: string | null
          event_type?: string
          id?: string
          invoice_number?: string
          registry_id?: string
          source_id?: string
          source_table?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_number_audit_events_registry_id_fkey"
            columns: ["registry_id"]
            isOneToOne: false
            referencedRelation: "invoice_number_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_number_audit_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_number_registry: {
        Row: {
          created_at: string
          id: string
          invoice_number: string
          invoice_type: string
          invoice_year: number
          issued_at: string
          issued_by: string | null
          sequence_number: number
          source_id: string
          source_table: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_number: string
          invoice_type: string
          invoice_year: number
          issued_at: string
          issued_by?: string | null
          sequence_number: number
          source_id: string
          source_table: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invoice_number?: string
          invoice_type?: string
          invoice_year?: number
          issued_at?: string
          issued_by?: string | null
          sequence_number?: number
          source_id?: string
          source_table?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_number_registry_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_number_sequences: {
        Row: {
          invoice_year: number
          next_value: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          invoice_year: number
          next_value: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          invoice_year?: number
          next_value?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_number_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_numbering_settings: {
        Row: {
          activated_at: string
          activated_by: string | null
          created_at: string
          cutover_year: number
          first_invoice_number: string | null
          first_sequence: number
          numbering_format: string
          padding: number
          prefix: string
          start_year: number | null
          starting_sequence: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          activated_at: string
          activated_by?: string | null
          created_at?: string
          cutover_year: number
          first_invoice_number?: string | null
          first_sequence: number
          numbering_format?: string
          padding?: number
          prefix?: string
          start_year?: number | null
          starting_sequence?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          activated_at?: string
          activated_by?: string | null
          created_at?: string
          cutover_year?: number
          first_invoice_number?: string | null
          first_sequence?: number
          numbering_format?: string
          padding?: number
          prefix?: string
          start_year?: number | null
          starting_sequence?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_numbering_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          due_date: string | null
          id: string
          idempotency_key: string | null
          invoice_number: string
          job_order_id: string
          paid_at: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tenant_id: string
          total: number
          updated_at: string
          vat: number
        }
        Insert: {
          created_at?: string
          due_date?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_number: string
          job_order_id: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tenant_id: string
          total?: number
          updated_at?: string
          vat?: number
        }
        Update: {
          created_at?: string
          due_date?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_number?: string
          job_order_id?: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tenant_id?: string
          total?: number
          updated_at?: string
          vat?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "invoices_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "invoices_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_order_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          job_order_id: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          job_order_id: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          job_order_id?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_order_logs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "job_order_logs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "job_order_logs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_order_logs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_order_logs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "job_order_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_order_parts: {
        Row: {
          created_at: string
          id: string
          inventory_id: string
          job_order_id: string
          quantity: number
          tenant_id: string
          total_price: number | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          inventory_id: string
          job_order_id: string
          quantity?: number
          tenant_id: string
          total_price?: number | null
          unit_price?: number
        }
        Update: {
          created_at?: string
          id?: string
          inventory_id?: string
          job_order_id?: string
          quantity?: number
          tenant_id?: string
          total_price?: number | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_order_parts_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_order_parts_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "job_order_parts_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "job_order_parts_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_order_parts_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_order_parts_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "job_order_parts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_orders: {
        Row: {
          archived_at: string | null
          claim_id: string | null
          completed_at: string | null
          created_at: string
          customer_id: string
          customer_relationship_note: string | null
          customer_relationship_to_vehicle: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          diagnosis: string | null
          diagnosis_notes: string | null
          entry_date: string | null
          estimated_completion: string | null
          final_total: number | null
          fuel_level_pct: number | null
          id: string
          insurance_approved: boolean | null
          insurance_claim_number: string | null
          insurance_company: string | null
          labor_cost: number
          metadata: Json
          notes: string | null
          odometer_km: number | null
          order_number: string
          parent_work_order_id: string | null
          parts_cost: number
          parts_needed: Json
          photos: Json
          received_at: string | null
          received_from_customer_id: string | null
          reception_damage_markers: Json
          reception_notes: string | null
          reception_photos: Json
          reception_signature_data_url: string | null
          return_reason: string | null
          service_type: string | null
          source_estimate_id: string | null
          stages: Json
          status: Database["public"]["Enums"]["job_status"]
          subtotal: number | null
          technician_id: string | null
          technician_name: string | null
          tenant_id: string
          tracking_expires_at: string | null
          tracking_token: string
          updated_at: string
          vat: number | null
          vehicle_belongings: Json
          vehicle_delivered_at: string | null
          vehicle_entry_id: string | null
          vehicle_id: string
          vehicle_location_bay: string | null
          vehicle_location_note: string | null
          vehicle_location_section: string | null
          vehicle_owner_customer_id: string | null
          vehicle_presence_status: string
          vehicle_received_at: string | null
          visit_number: number | null
          visit_type: string | null
          work_completed_at: string | null
          work_items: Json
          work_order_type: string
          work_started_at: string | null
        }
        Insert: {
          archived_at?: string | null
          claim_id?: string | null
          completed_at?: string | null
          created_at?: string
          customer_id: string
          customer_relationship_note?: string | null
          customer_relationship_to_vehicle?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          diagnosis?: string | null
          diagnosis_notes?: string | null
          entry_date?: string | null
          estimated_completion?: string | null
          final_total?: number | null
          fuel_level_pct?: number | null
          id?: string
          insurance_approved?: boolean | null
          insurance_claim_number?: string | null
          insurance_company?: string | null
          labor_cost?: number
          metadata?: Json
          notes?: string | null
          odometer_km?: number | null
          order_number: string
          parent_work_order_id?: string | null
          parts_cost?: number
          parts_needed?: Json
          photos?: Json
          received_at?: string | null
          received_from_customer_id?: string | null
          reception_damage_markers?: Json
          reception_notes?: string | null
          reception_photos?: Json
          reception_signature_data_url?: string | null
          return_reason?: string | null
          service_type?: string | null
          source_estimate_id?: string | null
          stages?: Json
          status?: Database["public"]["Enums"]["job_status"]
          subtotal?: number | null
          technician_id?: string | null
          technician_name?: string | null
          tenant_id: string
          tracking_expires_at?: string | null
          tracking_token?: string
          updated_at?: string
          vat?: number | null
          vehicle_belongings?: Json
          vehicle_delivered_at?: string | null
          vehicle_entry_id?: string | null
          vehicle_id: string
          vehicle_location_bay?: string | null
          vehicle_location_note?: string | null
          vehicle_location_section?: string | null
          vehicle_owner_customer_id?: string | null
          vehicle_presence_status?: string
          vehicle_received_at?: string | null
          visit_number?: number | null
          visit_type?: string | null
          work_completed_at?: string | null
          work_items?: Json
          work_order_type?: string
          work_started_at?: string | null
        }
        Update: {
          archived_at?: string | null
          claim_id?: string | null
          completed_at?: string | null
          created_at?: string
          customer_id?: string
          customer_relationship_note?: string | null
          customer_relationship_to_vehicle?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          diagnosis?: string | null
          diagnosis_notes?: string | null
          entry_date?: string | null
          estimated_completion?: string | null
          final_total?: number | null
          fuel_level_pct?: number | null
          id?: string
          insurance_approved?: boolean | null
          insurance_claim_number?: string | null
          insurance_company?: string | null
          labor_cost?: number
          metadata?: Json
          notes?: string | null
          odometer_km?: number | null
          order_number?: string
          parent_work_order_id?: string | null
          parts_cost?: number
          parts_needed?: Json
          photos?: Json
          received_at?: string | null
          received_from_customer_id?: string | null
          reception_damage_markers?: Json
          reception_notes?: string | null
          reception_photos?: Json
          reception_signature_data_url?: string | null
          return_reason?: string | null
          service_type?: string | null
          source_estimate_id?: string | null
          stages?: Json
          status?: Database["public"]["Enums"]["job_status"]
          subtotal?: number | null
          technician_id?: string | null
          technician_name?: string | null
          tenant_id?: string
          tracking_expires_at?: string | null
          tracking_token?: string
          updated_at?: string
          vat?: number | null
          vehicle_belongings?: Json
          vehicle_delivered_at?: string | null
          vehicle_entry_id?: string | null
          vehicle_id?: string
          vehicle_location_bay?: string | null
          vehicle_location_note?: string | null
          vehicle_location_section?: string | null
          vehicle_owner_customer_id?: string | null
          vehicle_presence_status?: string
          vehicle_received_at?: string | null
          visit_number?: number | null
          visit_type?: string | null
          work_completed_at?: string | null
          work_items?: Json
          work_order_type?: string
          work_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_orders_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "accounting_claims_summary_view"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "job_orders_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims_archive_report"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "job_orders_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "insurance_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_parent_work_order_id_fkey"
            columns: ["parent_work_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "job_orders_parent_work_order_id_fkey"
            columns: ["parent_work_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "job_orders_parent_work_order_id_fkey"
            columns: ["parent_work_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_parent_work_order_id_fkey"
            columns: ["parent_work_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_parent_work_order_id_fkey"
            columns: ["parent_work_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "job_orders_received_from_customer_id_fkey"
            columns: ["received_from_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_source_estimate_id_fkey"
            columns: ["source_estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_vehicle_entry_id_fkey"
            columns: ["vehicle_entry_id"]
            isOneToOne: false
            referencedRelation: "vehicle_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_vehicle_owner_customer_id_fkey"
            columns: ["vehicle_owner_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          entry_date: string
          entry_number: string
          id: string
          source_id: string | null
          source_reference: string | null
          source_type: string | null
          tenant_id: string
          total_credit: number
          total_debit: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_date?: string
          entry_number: string
          id?: string
          source_id?: string | null
          source_reference?: string | null
          source_type?: string | null
          tenant_id: string
          total_credit?: number
          total_debit?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_date?: string
          entry_number?: string
          id?: string
          source_id?: string | null
          source_reference?: string | null
          source_type?: string | null
          tenant_id?: string
          total_credit?: number
          total_debit?: number
          updated_at?: string
        }
        Relationships: []
      }
      journal_lines: {
        Row: {
          account_code: string
          account_name: string
          created_at: string
          credit: number
          debit: number
          entry_id: string
          id: string
          memo: string | null
          tenant_id: string
        }
        Insert: {
          account_code: string
          account_name: string
          created_at?: string
          credit?: number
          debit?: number
          entry_id: string
          id?: string
          memo?: string | null
          tenant_id: string
        }
        Update: {
          account_code?: string
          account_name?: string
          created_at?: string
          credit?: number
          debit?: number
          entry_id?: string
          id?: string
          memo?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      message_attachments: {
        Row: {
          attachment_type: string
          created_at: string
          direction: string
          file_name: string | null
          file_size: number | null
          id: string
          message_log_id: string | null
          mime_type: string | null
          provider_media_id: string | null
          public_url: string | null
          storage_path: string | null
          tenant_id: string
          whatsapp_log_id: string | null
        }
        Insert: {
          attachment_type?: string
          created_at?: string
          direction?: string
          file_name?: string | null
          file_size?: number | null
          id?: string
          message_log_id?: string | null
          mime_type?: string | null
          provider_media_id?: string | null
          public_url?: string | null
          storage_path?: string | null
          tenant_id: string
          whatsapp_log_id?: string | null
        }
        Update: {
          attachment_type?: string
          created_at?: string
          direction?: string
          file_name?: string | null
          file_size?: number | null
          id?: string
          message_log_id?: string | null
          mime_type?: string | null
          provider_media_id?: string | null
          public_url?: string | null
          storage_path?: string | null
          tenant_id?: string
          whatsapp_log_id?: string | null
        }
        Relationships: []
      }
      message_idempotency_keys: {
        Row: {
          channel: string
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string
          logical_action: string | null
          message_log_id: string | null
          recipient: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key: string
          logical_action?: string | null
          message_log_id?: string | null
          recipient?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          logical_action?: string | null
          message_log_id?: string | null
          recipient?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      message_logs: {
        Row: {
          body: string | null
          call_notes: string | null
          call_result: string | null
          channel: string
          claim_id: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          delivered_at: string | null
          direction: string
          error: string | null
          failed_at: string | null
          failure_code: string | null
          failure_reason: string | null
          follow_up_at: string | null
          id: string
          idempotency_key: string | null
          invoice_id: string | null
          message: string
          message_type: string
          metadata: Json
          provider: string | null
          provider_message_id: string | null
          provider_response: Json
          queued_at: string | null
          read_at: string | null
          recipient_email: string | null
          recipient_phone: string | null
          sent_at: string
          short_link: string | null
          status: string
          template_key: string | null
          template_type: string | null
          tenant_id: string | null
          user_id: string | null
          vehicle_id: string | null
          work_order_id: string | null
        }
        Insert: {
          body?: string | null
          call_notes?: string | null
          call_result?: string | null
          channel?: string
          claim_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivered_at?: string | null
          direction?: string
          error?: string | null
          failed_at?: string | null
          failure_code?: string | null
          failure_reason?: string | null
          follow_up_at?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string | null
          message: string
          message_type?: string
          metadata?: Json
          provider?: string | null
          provider_message_id?: string | null
          provider_response?: Json
          queued_at?: string | null
          read_at?: string | null
          recipient_email?: string | null
          recipient_phone?: string | null
          sent_at?: string
          short_link?: string | null
          status?: string
          template_key?: string | null
          template_type?: string | null
          tenant_id?: string | null
          user_id?: string | null
          vehicle_id?: string | null
          work_order_id?: string | null
        }
        Update: {
          body?: string | null
          call_notes?: string | null
          call_result?: string | null
          channel?: string
          claim_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivered_at?: string | null
          direction?: string
          error?: string | null
          failed_at?: string | null
          failure_code?: string | null
          failure_reason?: string | null
          follow_up_at?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string | null
          message?: string
          message_type?: string
          metadata?: Json
          provider?: string | null
          provider_message_id?: string | null
          provider_response?: Json
          queued_at?: string | null
          read_at?: string | null
          recipient_email?: string | null
          recipient_phone?: string | null
          sent_at?: string
          short_link?: string | null
          status?: string
          template_key?: string | null
          template_type?: string | null
          tenant_id?: string | null
          user_id?: string | null
          vehicle_id?: string | null
          work_order_id?: string | null
        }
        Relationships: []
      }
      notification_rules: {
        Row: {
          channels: string[]
          created_at: string
          enabled: boolean
          exclude_statuses: string[]
          id: string
          repeat_every_days: number
          require_approval: boolean
          rule_key: string
          send_mode: string
          template_ar: string | null
          template_en: string | null
          tenant_id: string
          trigger_days: number
          updated_at: string
        }
        Insert: {
          channels?: string[]
          created_at?: string
          enabled?: boolean
          exclude_statuses?: string[]
          id?: string
          repeat_every_days?: number
          require_approval?: boolean
          rule_key: string
          send_mode?: string
          template_ar?: string | null
          template_en?: string | null
          tenant_id: string
          trigger_days?: number
          updated_at?: string
        }
        Update: {
          channels?: string[]
          created_at?: string
          enabled?: boolean
          exclude_statuses?: string[]
          id?: string
          repeat_every_days?: number
          require_approval?: boolean
          rule_key?: string
          send_mode?: string
          template_ar?: string | null
          template_en?: string | null
          tenant_id?: string
          trigger_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      operational_audit_log: {
        Row: {
          action: string
          after_snapshot: Json | null
          before_snapshot: Json | null
          created_at: string
          delete_mode: string | null
          entity_id: string
          entity_type: string
          id: string
          reason: string | null
          related_entities: Json
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          after_snapshot?: Json | null
          before_snapshot?: Json | null
          created_at?: string
          delete_mode?: string | null
          entity_id: string
          entity_type: string
          id?: string
          reason?: string | null
          related_entities?: Json
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          after_snapshot?: Json | null
          before_snapshot?: Json | null
          created_at?: string
          delete_mode?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          reason?: string | null
          related_entities?: Json
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      payment_links: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          currency: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          expires_at: string | null
          gateway: string
          hosted_url: string | null
          id: string
          metadata: Json
          paid_at: string | null
          provider_session_id: string | null
          source_id: string | null
          source_reference: string | null
          source_type: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          expires_at?: string | null
          gateway: string
          hosted_url?: string | null
          id?: string
          metadata?: Json
          paid_at?: string | null
          provider_session_id?: string | null
          source_id?: string | null
          source_reference?: string | null
          source_type: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          expires_at?: string | null
          gateway?: string
          hosted_url?: string | null
          id?: string
          metadata?: Json
          paid_at?: string | null
          provider_session_id?: string | null
          source_id?: string | null
          source_reference?: string | null
          source_type?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      print_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          doc_type: string
          id: string
          is_default: boolean
          is_system: boolean
          name: string
          schema: Json
          tenant_id: string
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          doc_type: string
          id?: string
          is_default?: boolean
          is_system?: boolean
          name: string
          schema?: Json
          tenant_id: string
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          doc_type?: string
          id?: string
          is_default?: boolean
          is_system?: boolean
          name?: string
          schema?: Json
          tenant_id?: string
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_status: string
          avatar_url: string | null
          created_at: string
          disabled_at: string | null
          disabled_by: string | null
          full_name: string
          id: string
          invited_at: string | null
          is_platform_admin: boolean
          last_seen_at: string | null
          last_sign_in_at: string | null
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_status?: string
          avatar_url?: string | null
          created_at?: string
          disabled_at?: string | null
          disabled_by?: string | null
          full_name?: string
          id?: string
          invited_at?: string | null
          is_platform_admin?: boolean
          last_seen_at?: string | null
          last_sign_in_at?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_status?: string
          avatar_url?: string | null
          created_at?: string
          disabled_at?: string | null
          disabled_by?: string | null
          full_name?: string
          id?: string
          invited_at?: string | null
          is_platform_admin?: boolean
          last_seen_at?: string | null
          last_sign_in_at?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      public_tracking_logs: {
        Row: {
          claim_id: string | null
          id: string
          metadata: Json
          opened_at: string
          result: string
          short_code: string
          target_type: string
          user_agent: string | null
          vehicle_id: string | null
          work_order_id: string | null
        }
        Insert: {
          claim_id?: string | null
          id?: string
          metadata?: Json
          opened_at?: string
          result?: string
          short_code: string
          target_type?: string
          user_agent?: string | null
          vehicle_id?: string | null
          work_order_id?: string | null
        }
        Update: {
          claim_id?: string | null
          id?: string
          metadata?: Json
          opened_at?: string
          result?: string
          short_code?: string
          target_type?: string
          user_agent?: string | null
          vehicle_id?: string | null
          work_order_id?: string | null
        }
        Relationships: []
      }
      purchase_invoices: {
        Row: {
          attachments: Json
          balance_due: number
          created_at: string
          created_by: string | null
          date: string
          discount: number
          due_date: string | null
          id: string
          invoice_number: string
          items: Json
          notes: string | null
          paid_amount: number
          status: string
          subtotal: number
          supplier_id: string | null
          supplier_invoice_number: string | null
          supplier_name: string
          tenant_id: string
          total: number
          updated_at: string
          vat: number
        }
        Insert: {
          attachments?: Json
          balance_due?: number
          created_at?: string
          created_by?: string | null
          date?: string
          discount?: number
          due_date?: string | null
          id?: string
          invoice_number: string
          items?: Json
          notes?: string | null
          paid_amount?: number
          status?: string
          subtotal?: number
          supplier_id?: string | null
          supplier_invoice_number?: string | null
          supplier_name: string
          tenant_id: string
          total?: number
          updated_at?: string
          vat?: number
        }
        Update: {
          attachments?: Json
          balance_due?: number
          created_at?: string
          created_by?: string | null
          date?: string
          discount?: number
          due_date?: string | null
          id?: string
          invoice_number?: string
          items?: Json
          notes?: string | null
          paid_amount?: number
          status?: string
          subtotal?: number
          supplier_id?: string | null
          supplier_invoice_number?: string | null
          supplier_name?: string
          tenant_id?: string
          total?: number
          updated_at?: string
          vat?: number
        }
        Relationships: []
      }
      report_saved_views: {
        Row: {
          created_at: string
          filters: Json
          id: string
          is_shared: boolean
          name: string
          report_key: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          is_shared?: boolean
          name: string
          report_key: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          is_shared?: boolean
          name?: string
          report_key?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sales_documents: {
        Row: {
          archived_at: string | null
          balance_due: number
          cancellation_reason: string | null
          converted_invoice_id: string | null
          created_at: string
          created_by: string | null
          credit_note_id: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          date: string
          deleted_at: string | null
          deleted_by: string | null
          discount_total: number
          doc_number: string
          doc_type: string
          due_date: string | null
          id: string
          invoice_hash: string | null
          invoice_snapshot_json: Json | null
          invoice_status: string
          issued_at: string | null
          issued_by: string | null
          items: Json
          last_payment_date: string | null
          locked_at: string | null
          locked_by: string | null
          metadata: Json
          notes: string | null
          paid_amount: number
          pdf_snapshot_url: string | null
          status: string
          subtotal: number
          tax_total: number
          tenant_id: string
          total: number
          updated_at: string
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_plate: string | null
          work_order_id: string | null
        }
        Insert: {
          archived_at?: string | null
          balance_due?: number
          cancellation_reason?: string | null
          converted_invoice_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_note_id?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          date?: string
          deleted_at?: string | null
          deleted_by?: string | null
          discount_total?: number
          doc_number: string
          doc_type?: string
          due_date?: string | null
          id?: string
          invoice_hash?: string | null
          invoice_snapshot_json?: Json | null
          invoice_status?: string
          issued_at?: string | null
          issued_by?: string | null
          items?: Json
          last_payment_date?: string | null
          locked_at?: string | null
          locked_by?: string | null
          metadata?: Json
          notes?: string | null
          paid_amount?: number
          pdf_snapshot_url?: string | null
          status?: string
          subtotal?: number
          tax_total?: number
          tenant_id: string
          total?: number
          updated_at?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_plate?: string | null
          work_order_id?: string | null
        }
        Update: {
          archived_at?: string | null
          balance_due?: number
          cancellation_reason?: string | null
          converted_invoice_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_note_id?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          date?: string
          deleted_at?: string | null
          deleted_by?: string | null
          discount_total?: number
          doc_number?: string
          doc_type?: string
          due_date?: string | null
          id?: string
          invoice_hash?: string | null
          invoice_snapshot_json?: Json | null
          invoice_status?: string
          issued_at?: string | null
          issued_by?: string | null
          items?: Json
          last_payment_date?: string | null
          locked_at?: string | null
          locked_by?: string | null
          metadata?: Json
          notes?: string | null
          paid_amount?: number
          pdf_snapshot_url?: string | null
          status?: string
          subtotal?: number
          tax_total?: number
          tenant_id?: string
          total?: number
          updated_at?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_plate?: string | null
          work_order_id?: string | null
        }
        Relationships: []
      }
      sales_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          date: string
          id: string
          method: string
          notes: string | null
          payment_number: string
          reference: string | null
          sales_document_id: string
          tenant_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          method?: string
          notes?: string | null
          payment_number: string
          reference?: string | null
          sales_document_id: string
          tenant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          method?: string
          notes?: string | null
          payment_number?: string
          reference?: string | null
          sales_document_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_payments_sales_document_id_fkey"
            columns: ["sales_document_id"]
            isOneToOne: false
            referencedRelation: "sales_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_payments_sales_document_id_fkey"
            columns: ["sales_document_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices_archive_report"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      security_action_otps: {
        Row: {
          action: string
          attempt_count: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          last_attempt_at: string | null
          locked_until: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          action: string
          attempt_count?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          last_attempt_at?: string | null
          locked_until?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          action?: string
          attempt_count?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          last_attempt_at?: string | null
          locked_until?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_action_otps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      security_otp_audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json
          event: string
          id: string
          ip: string | null
          status: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json
          event: string
          id?: string
          ip?: string | null
          status: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json
          event?: string
          id?: string
          ip?: string | null
          status?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      sms_logs: {
        Row: {
          body: string
          created_at: string
          error: string | null
          id: string
          provider_sid: string | null
          status: string
          tenant_id: string
          to_number: string
          user_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          error?: string | null
          id?: string
          provider_sid?: string | null
          status?: string
          tenant_id: string
          to_number: string
          user_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          error?: string | null
          id?: string
          provider_sid?: string | null
          status?: string
          tenant_id?: string
          to_number?: string
          user_id?: string | null
        }
        Relationships: []
      }
      supplement_approval_requests: {
        Row: {
          created_at: string
          created_by: string | null
          customer_name_snapshot: string | null
          customer_phone_snapshot: string | null
          decisions: Json
          expires_at: string
          id: string
          job_order_id: string
          signature_data_url: string | null
          signed_at: string | null
          signer_ip: string | null
          signer_user_agent: string | null
          status: string
          supplement_ids: string[]
          tenant_id: string
          token: string
          total_approved: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_name_snapshot?: string | null
          customer_phone_snapshot?: string | null
          decisions?: Json
          expires_at?: string
          id?: string
          job_order_id: string
          signature_data_url?: string | null
          signed_at?: string | null
          signer_ip?: string | null
          signer_user_agent?: string | null
          status?: string
          supplement_ids?: string[]
          tenant_id: string
          token: string
          total_approved?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_name_snapshot?: string | null
          customer_phone_snapshot?: string | null
          decisions?: Json
          expires_at?: string
          id?: string
          job_order_id?: string
          signature_data_url?: string | null
          signed_at?: string | null
          signer_ip?: string | null
          signer_user_agent?: string | null
          status?: string
          supplement_ids?: string[]
          tenant_id?: string
          token?: string
          total_approved?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplement_approval_requests_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "supplement_approval_requests_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "supplement_approval_requests_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplement_approval_requests_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplement_approval_requests_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
        ]
      }
      supplement_audit_logs: {
        Row: {
          action: string
          actor: string
          created_at: string
          details: Json | null
          id: string
          ip: string | null
          job_order_id: string | null
          request_id: string | null
          tenant_id: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          actor?: string
          created_at?: string
          details?: Json | null
          id?: string
          ip?: string | null
          job_order_id?: string | null
          request_id?: string | null
          tenant_id: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          actor?: string
          created_at?: string
          details?: Json | null
          id?: string
          ip?: string | null
          job_order_id?: string | null
          request_id?: string | null
          tenant_id?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplement_audit_logs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "supplement_audit_logs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "supplement_audit_logs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplement_audit_logs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplement_audit_logs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "supplement_audit_logs_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "supplement_approval_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          amount: number
          bank_name: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          payment_date: string
          payment_method: string
          payment_number: string
          purchase_invoice_id: string | null
          reference_number: string | null
          supplier_id: string | null
          supplier_name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          bank_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string
          payment_number: string
          purchase_invoice_id?: string | null
          reference_number?: string | null
          supplier_id?: string | null
          supplier_name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string
          payment_number?: string
          purchase_invoice_id?: string | null
          reference_number?: string | null
          supplier_id?: string | null
          supplier_name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          address: string | null
          bank_name: string | null
          category: string | null
          commercial_registration: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          iban: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          payment_terms_days: number
          phone: string | null
          tax_number: string | null
          tenant_id: string
          updated_at: string
          vehicle_brands: string[]
        }
        Insert: {
          address?: string | null
          bank_name?: string | null
          category?: string | null
          commercial_registration?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          iban?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          payment_terms_days?: number
          phone?: string | null
          tax_number?: string | null
          tenant_id: string
          updated_at?: string
          vehicle_brands?: string[]
        }
        Update: {
          address?: string | null
          bank_name?: string | null
          category?: string | null
          commercial_registration?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          iban?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          payment_terms_days?: number
          phone?: string | null
          tax_number?: string | null
          tenant_id?: string
          updated_at?: string
          vehicle_brands?: string[]
        }
        Relationships: []
      }
      technician_notes: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          note: string
          technician_id: string | null
          technician_name: string
          tenant_id: string
          updated_at: string
          work_order_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          note: string
          technician_id?: string | null
          technician_name?: string
          tenant_id: string
          updated_at?: string
          work_order_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          note?: string
          technician_id?: string | null
          technician_name?: string
          tenant_id?: string
          updated_at?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "technician_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      technician_time_logs: {
        Row: {
          clock_in: string
          clock_out: string | null
          created_at: string
          id: string
          minutes: number | null
          notes: string | null
          pause_reason: string | null
          photos: Json
          status: string
          task_id: string | null
          technician_id: string | null
          technician_name: string
          tenant_id: string
          updated_at: string
          work_order_id: string | null
        }
        Insert: {
          clock_in?: string
          clock_out?: string | null
          created_at?: string
          id?: string
          minutes?: number | null
          notes?: string | null
          pause_reason?: string | null
          photos?: Json
          status?: string
          task_id?: string | null
          technician_id?: string | null
          technician_name?: string
          tenant_id: string
          updated_at?: string
          work_order_id?: string | null
        }
        Update: {
          clock_in?: string
          clock_out?: string | null
          created_at?: string
          id?: string
          minutes?: number | null
          notes?: string | null
          pause_reason?: string | null
          photos?: Json
          status?: string
          task_id?: string | null
          technician_id?: string | null
          technician_name?: string
          tenant_id?: string
          updated_at?: string
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "technician_time_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_domains: {
        Row: {
          activated_at: string | null
          created_at: string
          created_by: string | null
          dns_instructions: Json
          domain_type: string
          hostname: string
          id: string
          status: string
          tenant_id: string
          updated_at: string
          verification_error: string | null
          verification_token: string
          verified_at: string | null
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          created_by?: string | null
          dns_instructions?: Json
          domain_type?: string
          hostname: string
          id?: string
          status?: string
          tenant_id: string
          updated_at?: string
          verification_error?: string | null
          verification_token?: string
          verified_at?: string | null
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          created_by?: string | null
          dns_instructions?: Json
          domain_type?: string
          hostname?: string
          id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          verification_error?: string | null
          verification_token?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_domains_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_features: {
        Row: {
          created_at: string
          enabled: boolean
          feature_key: string
          id: string
          settings: Json
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          feature_key: string
          id?: string
          settings?: Json
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          feature_key?: string
          id?: string
          settings?: Json
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_features_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_files: {
        Row: {
          bucket_id: string
          category: string
          claim_id: string | null
          content_type: string | null
          created_at: string
          customer_id: string | null
          deleted_at: string | null
          file_name: string
          id: string
          job_order_id: string | null
          metadata: Json
          size_bytes: number
          storage_path: string
          tenant_id: string
          uploaded_by: string | null
          vehicle_id: string | null
        }
        Insert: {
          bucket_id?: string
          category?: string
          claim_id?: string | null
          content_type?: string | null
          created_at?: string
          customer_id?: string | null
          deleted_at?: string | null
          file_name: string
          id?: string
          job_order_id?: string | null
          metadata?: Json
          size_bytes?: number
          storage_path: string
          tenant_id: string
          uploaded_by?: string | null
          vehicle_id?: string | null
        }
        Update: {
          bucket_id?: string
          category?: string
          claim_id?: string | null
          content_type?: string | null
          created_at?: string
          customer_id?: string | null
          deleted_at?: string | null
          file_name?: string
          id?: string
          job_order_id?: string | null
          metadata?: Json
          size_bytes?: number
          storage_path?: string
          tenant_id?: string
          uploaded_by?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_files_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "accounting_claims_summary_view"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "tenant_files_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims_archive_report"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "tenant_files_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "insurance_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_files_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_files_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "tenant_files_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "tenant_files_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_files_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_files_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "tenant_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_files_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_integrations: {
        Row: {
          config: Json
          created_at: string
          enabled: boolean
          id: string
          last_error: string | null
          last_health_check_at: string | null
          last_success_at: string | null
          last_test_at: string | null
          last_test_error: string | null
          last_test_status: string | null
          last_tested_at: string | null
          provider: string
          secrets: Json
          status: string | null
          templates_sync_status: string | null
          templates_synced_at: string | null
          tenant_id: string
          token_expires_at: string | null
          updated_at: string
          webhook_status: string | null
          webhook_url: string | null
        }
        Insert: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_health_check_at?: string | null
          last_success_at?: string | null
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          provider: string
          secrets?: Json
          status?: string | null
          templates_sync_status?: string | null
          templates_synced_at?: string | null
          tenant_id: string
          token_expires_at?: string | null
          updated_at?: string
          webhook_status?: string | null
          webhook_url?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_health_check_at?: string | null
          last_success_at?: string | null
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          provider?: string
          secrets?: Json
          status?: string | null
          templates_sync_status?: string | null
          templates_synced_at?: string | null
          tenant_id?: string
          token_expires_at?: string | null
          updated_at?: string
          webhook_status?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      tenant_security_settings: {
        Row: {
          cloud_reset_enabled: boolean
          login_otp_enabled: boolean
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cloud_reset_enabled?: boolean
          login_otp_enabled?: boolean
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cloud_reset_enabled?: boolean
          login_otp_enabled?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_security_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          value: Json
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
          version?: number
        }
        Relationships: []
      }
      tenant_sms_settings: {
        Row: {
          account_sid: string | null
          auth_token: string | null
          created_at: string
          enabled: boolean
          from_number: string | null
          id: string
          provider: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_sid?: string | null
          auth_token?: string | null
          created_at?: string
          enabled?: boolean
          from_number?: string | null
          id?: string
          provider?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_sid?: string | null
          auth_token?: string | null
          created_at?: string
          enabled?: boolean
          from_number?: string | null
          id?: string
          provider?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          legal_name: string | null
          logo_url: string | null
          name: string
          phone: string | null
          settings: Json
          slug: string | null
          subscription_expires_at: string | null
          subscription_plan: Database["public"]["Enums"]["subscription_plan"]
          subscription_status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          logo_url?: string | null
          name: string
          phone?: string | null
          settings?: Json
          slug?: string | null
          subscription_expires_at?: string | null
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          subscription_status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          logo_url?: string | null
          name?: string
          phone?: string | null
          settings?: Json
          slug?: string | null
          subscription_expires_at?: string | null
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          subscription_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: []
      }
      vehicle_entries: {
        Row: {
          arrival_date: string
          arrival_method: string | null
          arrival_time: string
          converted_claim_id: string | null
          converted_work_order_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_snapshot: Json
          damage_map: Json
          declaration_ar: string | null
          declaration_en: string | null
          deleted_at: string | null
          delivered_by: Json
          entry_number: string
          id: string
          insurance_claim_id: string | null
          insurance_company_id: string | null
          insurance_snapshot: Json
          issued_at: string | null
          issued_by: string | null
          received_by_name: string | null
          received_by_user_id: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vehicle_condition: Json
          vehicle_contents: Json
          vehicle_id: string | null
          vehicle_location: string | null
          vehicle_location_bay: string | null
          vehicle_snapshot: Json
          work_order_id: string | null
        }
        Insert: {
          arrival_date?: string
          arrival_method?: string | null
          arrival_time?: string
          converted_claim_id?: string | null
          converted_work_order_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_snapshot?: Json
          damage_map?: Json
          declaration_ar?: string | null
          declaration_en?: string | null
          deleted_at?: string | null
          delivered_by?: Json
          entry_number: string
          id?: string
          insurance_claim_id?: string | null
          insurance_company_id?: string | null
          insurance_snapshot?: Json
          issued_at?: string | null
          issued_by?: string | null
          received_by_name?: string | null
          received_by_user_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          vehicle_condition?: Json
          vehicle_contents?: Json
          vehicle_id?: string | null
          vehicle_location?: string | null
          vehicle_location_bay?: string | null
          vehicle_snapshot?: Json
          work_order_id?: string | null
        }
        Update: {
          arrival_date?: string
          arrival_method?: string | null
          arrival_time?: string
          converted_claim_id?: string | null
          converted_work_order_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_snapshot?: Json
          damage_map?: Json
          declaration_ar?: string | null
          declaration_en?: string | null
          deleted_at?: string | null
          delivered_by?: Json
          entry_number?: string
          id?: string
          insurance_claim_id?: string | null
          insurance_company_id?: string | null
          insurance_snapshot?: Json
          issued_at?: string | null
          issued_by?: string | null
          received_by_name?: string | null
          received_by_user_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_condition?: Json
          vehicle_contents?: Json
          vehicle_id?: string | null
          vehicle_location?: string | null
          vehicle_location_bay?: string | null
          vehicle_snapshot?: Json
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_entries_converted_claim_id_fkey"
            columns: ["converted_claim_id"]
            isOneToOne: false
            referencedRelation: "accounting_claims_summary_view"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "vehicle_entries_converted_claim_id_fkey"
            columns: ["converted_claim_id"]
            isOneToOne: false
            referencedRelation: "claims_archive_report"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "vehicle_entries_converted_claim_id_fkey"
            columns: ["converted_claim_id"]
            isOneToOne: false
            referencedRelation: "insurance_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_entries_converted_work_order_id_fkey"
            columns: ["converted_work_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "vehicle_entries_converted_work_order_id_fkey"
            columns: ["converted_work_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "vehicle_entries_converted_work_order_id_fkey"
            columns: ["converted_work_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_entries_converted_work_order_id_fkey"
            columns: ["converted_work_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_entries_converted_work_order_id_fkey"
            columns: ["converted_work_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "vehicle_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_entries_insurance_claim_id_fkey"
            columns: ["insurance_claim_id"]
            isOneToOne: false
            referencedRelation: "accounting_claims_summary_view"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "vehicle_entries_insurance_claim_id_fkey"
            columns: ["insurance_claim_id"]
            isOneToOne: false
            referencedRelation: "claims_archive_report"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "vehicle_entries_insurance_claim_id_fkey"
            columns: ["insurance_claim_id"]
            isOneToOne: false
            referencedRelation: "insurance_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_entries_insurance_company_id_fkey"
            columns: ["insurance_company_id"]
            isOneToOne: false
            referencedRelation: "insurance_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_entries_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_entries_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "vehicle_entries_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "vehicle_entries_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_entries_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_entries_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
        ]
      }
      vehicle_entry_audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          new_value: Json | null
          old_value: Json | null
          reason: string | null
          tenant_id: string
          user_id: string | null
          vehicle_entry_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          reason?: string | null
          tenant_id: string
          user_id?: string | null
          vehicle_entry_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          reason?: string | null
          tenant_id?: string
          user_id?: string | null
          vehicle_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_entry_audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_entry_audit_logs_vehicle_entry_id_fkey"
            columns: ["vehicle_entry_id"]
            isOneToOne: false
            referencedRelation: "vehicle_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_entry_damage_marks: {
        Row: {
          color: string | null
          created_at: string
          damage_type: string | null
          description: string | null
          expected_action: string | null
          id: string
          mark_number: number
          notes: string | null
          related_to_incident: boolean | null
          tenant_id: string
          updated_at: string
          vehicle_entry_id: string
          vehicle_part: string | null
          x: number | null
          y: number | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          damage_type?: string | null
          description?: string | null
          expected_action?: string | null
          id?: string
          mark_number: number
          notes?: string | null
          related_to_incident?: boolean | null
          tenant_id: string
          updated_at?: string
          vehicle_entry_id: string
          vehicle_part?: string | null
          x?: number | null
          y?: number | null
        }
        Update: {
          color?: string | null
          created_at?: string
          damage_type?: string | null
          description?: string | null
          expected_action?: string | null
          id?: string
          mark_number?: number
          notes?: string | null
          related_to_incident?: boolean | null
          tenant_id?: string
          updated_at?: string
          vehicle_entry_id?: string
          vehicle_part?: string | null
          x?: number | null
          y?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_entry_damage_marks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_entry_damage_marks_vehicle_entry_id_fkey"
            columns: ["vehicle_entry_id"]
            isOneToOne: false
            referencedRelation: "vehicle_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_entry_documents: {
        Row: {
          deleted_at: string | null
          document_type: string
          file_name: string | null
          id: string
          notes: string | null
          tenant_id: string
          uploaded_at: string
          uploaded_by: string | null
          vehicle_entry_id: string
          vehicle_media_id: string | null
        }
        Insert: {
          deleted_at?: string | null
          document_type?: string
          file_name?: string | null
          id?: string
          notes?: string | null
          tenant_id: string
          uploaded_at?: string
          uploaded_by?: string | null
          vehicle_entry_id: string
          vehicle_media_id?: string | null
        }
        Update: {
          deleted_at?: string | null
          document_type?: string
          file_name?: string | null
          id?: string
          notes?: string | null
          tenant_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
          vehicle_entry_id?: string
          vehicle_media_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_entry_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_entry_documents_vehicle_entry_id_fkey"
            columns: ["vehicle_entry_id"]
            isOneToOne: false
            referencedRelation: "vehicle_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_entry_documents_vehicle_media_id_fkey"
            columns: ["vehicle_media_id"]
            isOneToOne: false
            referencedRelation: "vehicle_media"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_entry_sequences: {
        Row: {
          created_at: string
          current_value: number
          tenant_id: string
          updated_at: string
          year_value: number
        }
        Insert: {
          created_at?: string
          current_value?: number
          tenant_id: string
          updated_at?: string
          year_value: number
        }
        Update: {
          created_at?: string
          current_value?: number
          tenant_id?: string
          updated_at?: string
          year_value?: number
        }
        Relationships: []
      }
      vehicle_entry_signatures: {
        Row: {
          created_at: string
          id: string
          override_reason: string | null
          signature_data_url: string | null
          signature_role: string
          signed_at: string | null
          signed_by: string | null
          signer_name: string | null
          signer_phone: string | null
          signer_title: string | null
          tenant_id: string
          vehicle_entry_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          override_reason?: string | null
          signature_data_url?: string | null
          signature_role: string
          signed_at?: string | null
          signed_by?: string | null
          signer_name?: string | null
          signer_phone?: string | null
          signer_title?: string | null
          tenant_id: string
          vehicle_entry_id: string
        }
        Update: {
          created_at?: string
          id?: string
          override_reason?: string | null
          signature_data_url?: string | null
          signature_role?: string
          signed_at?: string | null
          signed_by?: string | null
          signer_name?: string | null
          signer_phone?: string | null
          signer_title?: string | null
          tenant_id?: string
          vehicle_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_entry_signatures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_entry_signatures_vehicle_entry_id_fkey"
            columns: ["vehicle_entry_id"]
            isOneToOne: false
            referencedRelation: "vehicle_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_makes: {
        Row: {
          created_at: string
          id: string
          is_global: boolean
          name: string
          name_ar: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_global?: boolean
          name: string
          name_ar?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_global?: boolean
          name?: string
          name_ar?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      vehicle_media: {
        Row: {
          caption: string | null
          category: string
          claim_id: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          file_name: string | null
          file_size: number | null
          id: string
          legacy_reference: string | null
          legacy_source: string | null
          media_type: string
          mime_type: string | null
          public_url: string | null
          sort_order: number
          source: string | null
          stage: string | null
          storage_bucket: string
          storage_path: string
          tenant_id: string
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
          vehicle_entry_id: string | null
          vehicle_id: string | null
          work_order_id: string | null
        }
        Insert: {
          caption?: string | null
          category?: string
          claim_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          legacy_reference?: string | null
          legacy_source?: string | null
          media_type?: string
          mime_type?: string | null
          public_url?: string | null
          sort_order?: number
          source?: string | null
          stage?: string | null
          storage_bucket?: string
          storage_path: string
          tenant_id: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          vehicle_entry_id?: string | null
          vehicle_id?: string | null
          work_order_id?: string | null
        }
        Update: {
          caption?: string | null
          category?: string
          claim_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          legacy_reference?: string | null
          legacy_source?: string | null
          media_type?: string
          mime_type?: string | null
          public_url?: string | null
          sort_order?: number
          source?: string | null
          stage?: string | null
          storage_bucket?: string
          storage_path?: string
          tenant_id?: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          vehicle_entry_id?: string | null
          vehicle_id?: string | null
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_media_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "accounting_claims_summary_view"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "vehicle_media_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims_archive_report"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "vehicle_media_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "insurance_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_media_vehicle_entry_id_fkey"
            columns: ["vehicle_entry_id"]
            isOneToOne: false
            referencedRelation: "vehicle_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_media_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_media_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "vehicle_media_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "vehicle_media_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_media_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_media_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
        ]
      }
      vehicle_models: {
        Row: {
          created_at: string
          id: string
          is_global: boolean
          make_id: string
          name: string
          name_ar: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_global?: boolean
          make_id: string
          name: string
          name_ar?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_global?: boolean
          make_id?: string
          name?: string
          name_ar?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_models_make_id_fkey"
            columns: ["make_id"]
            isOneToOne: false
            referencedRelation: "vehicle_makes"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_stay_notifications: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          channel: string
          claim_id: string | null
          created_at: string
          customer_id: string | null
          delay_reason: string | null
          failed_at: string | null
          failure_reason: string | null
          id: string
          internal_note: string | null
          last_contact_at: string | null
          notification_type: string
          recipient: string | null
          scheduled_at: string | null
          sent_at: string | null
          snoozed_until: string | null
          status: string
          template_key: string | null
          tenant_id: string
          trigger_days: number
          updated_at: string
          vehicle_days_in_workshop: number
          vehicle_id: string | null
          work_order_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          channel?: string
          claim_id?: string | null
          created_at?: string
          customer_id?: string | null
          delay_reason?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          internal_note?: string | null
          last_contact_at?: string | null
          notification_type?: string
          recipient?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          snoozed_until?: string | null
          status?: string
          template_key?: string | null
          tenant_id: string
          trigger_days: number
          updated_at?: string
          vehicle_days_in_workshop: number
          vehicle_id?: string | null
          work_order_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          channel?: string
          claim_id?: string | null
          created_at?: string
          customer_id?: string | null
          delay_reason?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          internal_note?: string | null
          last_contact_at?: string | null
          notification_type?: string
          recipient?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          snoozed_until?: string | null
          status?: string
          template_key?: string | null
          tenant_id?: string
          trigger_days?: number
          updated_at?: string
          vehicle_days_in_workshop?: number
          vehicle_id?: string | null
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_stay_notifications_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "accounting_claims_summary_view"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "vehicle_stay_notifications_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims_archive_report"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "vehicle_stay_notifications_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "insurance_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_stay_notifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_stay_notifications_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_stay_notifications_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "vehicle_stay_notifications_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "vehicle_stay_notifications_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_stay_notifications_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_stay_notifications_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
        ]
      }
      vehicles: {
        Row: {
          archived: boolean
          archived_at: string | null
          archived_reason: string | null
          brand: string
          color: string | null
          created_at: string
          customer_id: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          mileage: number | null
          model: string
          plate_country: string
          plate_letters: string | null
          plate_number: string
          tenant_id: string
          updated_at: string
          vehicle_cover_image_url: string | null
          vehicle_thumbnail_url: string | null
          vehicle_type: string | null
          vin: string | null
          vin_number: string | null
          year: number | null
        }
        Insert: {
          archived?: boolean
          archived_at?: string | null
          archived_reason?: string | null
          brand: string
          color?: string | null
          created_at?: string
          customer_id: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          mileage?: number | null
          model: string
          plate_country?: string
          plate_letters?: string | null
          plate_number: string
          tenant_id: string
          updated_at?: string
          vehicle_cover_image_url?: string | null
          vehicle_thumbnail_url?: string | null
          vehicle_type?: string | null
          vin?: string | null
          vin_number?: string | null
          year?: number | null
        }
        Update: {
          archived?: boolean
          archived_at?: string | null
          archived_reason?: string | null
          brand?: string
          color?: string | null
          created_at?: string
          customer_id?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          mileage?: number | null
          model?: string
          plate_country?: string
          plate_letters?: string | null
          plate_number?: string
          tenant_id?: string
          updated_at?: string
          vehicle_cover_image_url?: string | null
          vehicle_thumbnail_url?: string | null
          vehicle_type?: string | null
          vin?: string | null
          vin_number?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversations: {
        Row: {
          assigned_user_id: string | null
          claim_id: string | null
          created_at: string
          customer_id: string | null
          customer_name_snapshot: string | null
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          phone: string
          status: string
          tenant_id: string
          unread_count: number
          updated_at: string
          vehicle_id: string | null
          work_order_id: string | null
        }
        Insert: {
          assigned_user_id?: string | null
          claim_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name_snapshot?: string | null
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          phone: string
          status?: string
          tenant_id: string
          unread_count?: number
          updated_at?: string
          vehicle_id?: string | null
          work_order_id?: string | null
        }
        Update: {
          assigned_user_id?: string | null
          claim_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name_snapshot?: string | null
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          phone?: string
          status?: string
          tenant_id?: string
          unread_count?: number
          updated_at?: string
          vehicle_id?: string | null
          work_order_id?: string | null
        }
        Relationships: []
      }
      whatsapp_logs: {
        Row: {
          created_at: string
          customer_id: string | null
          delivered_at: string | null
          direction: string
          error_message: string | null
          failed_at: string | null
          failure_code: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string | null
          insurance_claim_id: string | null
          job_order_id: string | null
          media_url: string | null
          message_body: string
          message_kind: string
          message_log_id: string | null
          meta_message_id: string | null
          payload: Json
          provider_message_id: string | null
          provider_response: Json
          read_at: string | null
          recipient_name: string | null
          recipient_phone: string
          recipient_type: string
          sent_at: string | null
          sent_by: string | null
          status: string
          tenant_id: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          delivered_at?: string | null
          direction?: string
          error_message?: string | null
          failed_at?: string | null
          failure_code?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          insurance_claim_id?: string | null
          job_order_id?: string | null
          media_url?: string | null
          message_body: string
          message_kind?: string
          message_log_id?: string | null
          meta_message_id?: string | null
          payload?: Json
          provider_message_id?: string | null
          provider_response?: Json
          read_at?: string | null
          recipient_name?: string | null
          recipient_phone: string
          recipient_type?: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          delivered_at?: string | null
          direction?: string
          error_message?: string | null
          failed_at?: string | null
          failure_code?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          insurance_claim_id?: string | null
          job_order_id?: string | null
          media_url?: string | null
          message_body?: string
          message_kind?: string
          message_log_id?: string | null
          meta_message_id?: string | null
          payload?: Json
          provider_message_id?: string | null
          provider_response?: Json
          read_at?: string | null
          recipient_name?: string | null
          recipient_phone?: string
          recipient_type?: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_logs_insurance_claim_id_fkey"
            columns: ["insurance_claim_id"]
            isOneToOne: false
            referencedRelation: "accounting_claims_summary_view"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "whatsapp_logs_insurance_claim_id_fkey"
            columns: ["insurance_claim_id"]
            isOneToOne: false
            referencedRelation: "claims_archive_report"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "whatsapp_logs_insurance_claim_id_fkey"
            columns: ["insurance_claim_id"]
            isOneToOne: false
            referencedRelation: "insurance_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_logs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "whatsapp_logs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "whatsapp_logs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_logs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_logs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "whatsapp_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_logs_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          body: string | null
          buttons: Json
          category: string | null
          created_at: string
          footer: string | null
          header_content: string | null
          header_type: string | null
          id: string
          language: string
          last_synced_at: string | null
          meta_template_id: string | null
          name: string
          rejection_reason: string | null
          status: string
          tenant_id: string
          updated_at: string
          variables_schema: Json
        }
        Insert: {
          body?: string | null
          buttons?: Json
          category?: string | null
          created_at?: string
          footer?: string | null
          header_content?: string | null
          header_type?: string | null
          id?: string
          language?: string
          last_synced_at?: string | null
          meta_template_id?: string | null
          name: string
          rejection_reason?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          variables_schema?: Json
        }
        Update: {
          body?: string | null
          buttons?: Json
          category?: string | null
          created_at?: string
          footer?: string | null
          header_content?: string | null
          header_type?: string | null
          id?: string
          language?: string
          last_synced_at?: string | null
          meta_template_id?: string | null
          name?: string
          rejection_reason?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          variables_schema?: Json
        }
        Relationships: []
      }
      whatsapp_webhook_events: {
        Row: {
          error: string | null
          event_hash: string
          event_type: string
          id: string
          meta_message_id: string | null
          payload: Json
          phone_number_id: string | null
          processed_at: string | null
          received_at: string
          status: string
          tenant_id: string | null
        }
        Insert: {
          error?: string | null
          event_hash: string
          event_type: string
          id?: string
          meta_message_id?: string | null
          payload?: Json
          phone_number_id?: string | null
          processed_at?: string | null
          received_at?: string
          status?: string
          tenant_id?: string | null
        }
        Update: {
          error?: string | null
          event_hash?: string
          event_type?: string
          id?: string
          meta_message_id?: string | null
          payload?: Json
          phone_number_id?: string | null
          processed_at?: string | null
          received_at?: string
          status?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      work_order_closing_audit: {
        Row: {
          action: string
          created_at: string
          details: Json
          id: string
          invoice_id: string | null
          tenant_id: string | null
          user_id: string | null
          work_order_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json
          id?: string
          invoice_id?: string | null
          tenant_id?: string | null
          user_id?: string | null
          work_order_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json
          id?: string
          invoice_id?: string | null
          tenant_id?: string | null
          user_id?: string | null
          work_order_id?: string
        }
        Relationships: []
      }
      work_order_number_renumber_audit: {
        Row: {
          id: string
          job_order_id: string
          new_order_number: string
          old_order_number: string
          renumber_year: string
          renumbered_at: string
          tenant_id: string
        }
        Insert: {
          id?: string
          job_order_id: string
          new_order_number: string
          old_order_number: string
          renumber_year: string
          renumbered_at?: string
          tenant_id: string
        }
        Update: {
          id?: string
          job_order_id?: string
          new_order_number?: string
          old_order_number?: string
          renumber_year?: string
          renumbered_at?: string
          tenant_id?: string
        }
        Relationships: []
      }
      work_order_supplements: {
        Row: {
          approval_request_id: string | null
          created_at: string
          created_by: string | null
          customer_decision_at: string | null
          description: string
          id: string
          job_order_id: string
          notes: string | null
          photos: Json
          quantity: number
          status: string
          tenant_id: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          approval_request_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_decision_at?: string | null
          description: string
          id?: string
          job_order_id: string
          notes?: string | null
          photos?: Json
          quantity?: number
          status?: string
          tenant_id: string
          unit_price?: number
          updated_at?: string
        }
        Update: {
          approval_request_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_decision_at?: string | null
          description?: string
          id?: string
          job_order_id?: string
          notes?: string | null
          photos?: Json
          quantity?: number
          status?: string
          tenant_id?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_supplements_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "work_order_supplements_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "work_order_supplements_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_supplements_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_supplements_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
        ]
      }
      workshop_belongings_settings: {
        Row: {
          created_at: string
          id: string
          items: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          items?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          items?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      accounting_claims_summary_view: {
        Row: {
          approved_amount: number | null
          claim_id: string | null
          claim_number: string | null
          customer_id: string | null
          expenses_total: number | null
          insurance_company_id: string | null
          invoice_subtotal: number | null
          invoice_total: number | null
          invoice_vat: number | null
          net_profit: number | null
          outstanding_amount: number | null
          paid_amount: number | null
          status: string | null
          tenant_id: string | null
          vehicle_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurance_claims_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_work_order_profit_view: {
        Row: {
          customer_id: string | null
          final_cost_source: string | null
          invoice_total: number | null
          labour_cost: number | null
          net_profit: number | null
          order_type: string | null
          other_expenses: number | null
          outstanding_amount: number | null
          paid_amount: number | null
          profit_margin: number | null
          revenue_ex_vat: number | null
          spare_parts_cost: number | null
          status: string | null
          tenant_id: string | null
          total_cost: number | null
          vat_output: number | null
          vehicle_id: string | null
          work_order_id: string | null
          work_order_number: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      claims_archive_report: {
        Row: {
          approved_amount: number | null
          claim_id: string | null
          claim_number: string | null
          created_at: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          delivered_at: string | null
          estimated_amount: number | null
          insurance_company: string | null
          insurance_company_id: string | null
          job_order_id: string | null
          order_number: string | null
          status: Database["public"]["Enums"]["claim_status"] | null
          tenant_id: string | null
          updated_at: string | null
          vehicle_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_plate: string | null
          work_completed_at: string | null
          work_started_at: string | null
          workshop_arrival_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurance_claims_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "accounting_work_order_profit_view"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "insurance_claims_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "delivered_vehicles_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "insurance_claims_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "reports_work_order_facts_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations_report"
            referencedColumns: ["job_order_id"]
          },
          {
            foreignKeyName: "insurance_claims_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      completed_work_orders_without_invoice_view: {
        Row: {
          approved_by_role: string | null
          closed_at: string | null
          customer_id: string | null
          skip_invoice_reason: string | null
          status: Database["public"]["Enums"]["job_status"] | null
          tenant_id: string | null
          vehicle_id: string | null
          work_order_id: string | null
          work_order_number: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      delivered_vehicles_report: {
        Row: {
          completed_at: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          entry_date: string | null
          expenses_total: number | null
          final_total: number | null
          insurance_claim_number: string | null
          insurance_company: string | null
          job_order_id: string | null
          labor_cost: number | null
          order_number: string | null
          parts_cost: number | null
          status: Database["public"]["Enums"]["job_status"] | null
          tenant_id: string | null
          updated_at: string | null
          vehicle_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_plate: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_statement_report: {
        Row: {
          balance_due: number | null
          claim_id: string | null
          claim_number: string | null
          due_date: string | null
          insurance_company_id: string | null
          insurance_company_name: string | null
          invoice_id: string | null
          invoice_number: string | null
          issued_at: string | null
          last_payment_date: string | null
          paid_amount: number | null
          pdf_url: string | null
          status: string | null
          subtotal: number | null
          tenant_id: string | null
          total: number | null
          vat: number | null
          vehicle_plate: string | null
        }
        Relationships: []
      }
      overdue_invoices_view: {
        Row: {
          balance_due: number | null
          customer_id: string | null
          customer_name: string | null
          days_overdue: number | null
          due_date: string | null
          invoice_id: string | null
          invoice_number: string | null
          paid_total: number | null
          status: string | null
          tenant_id: string | null
          total: number | null
        }
        Insert: {
          balance_due?: never
          customer_id?: string | null
          customer_name?: string | null
          days_overdue?: never
          due_date?: string | null
          invoice_id?: never
          invoice_number?: string | null
          paid_total?: never
          status?: string | null
          tenant_id?: string | null
          total?: number | null
        }
        Update: {
          balance_due?: never
          customer_id?: string | null
          customer_name?: string | null
          days_overdue?: never
          due_date?: string | null
          invoice_id?: never
          invoice_number?: string | null
          paid_total?: never
          status?: string | null
          tenant_id?: string | null
          total?: number | null
        }
        Relationships: []
      }
      reports_center_rows_v1: {
        Row: {
          actual_cost: number | null
          approved_amount: number | null
          business_type: string | null
          claim_id: string | null
          customer_id: string | null
          due_date: string | null
          estimate_amount: number | null
          extra: Json | null
          gross_profit: number | null
          insurance_company_id: string | null
          invoice_subtotal: number | null
          invoice_total: number | null
          outstanding: number | null
          paid: number | null
          party_name: string | null
          plate: string | null
          record_id: string | null
          reference: string | null
          report_date: string | null
          report_key: string | null
          secondary_reference: string | null
          status: string | null
          tenant_id: string | null
          vat: number | null
          vehicle_id: string | null
          vehicle_name: string | null
          work_order_id: string | null
          workshop_days: number | null
        }
        Relationships: []
      }
      reports_expense_facts_v1: {
        Row: {
          accounting_mapping_key: string | null
          archived_at: string | null
          beneficiary: string | null
          business_type: string | null
          category_name: string | null
          claim_id: string | null
          classification_status: string | null
          cost_center_id: string | null
          date: string | null
          deleted_at: string | null
          department_id: string | null
          description: string | null
          expense_category_id: string | null
          expense_scope: string | null
          expense_type: string | null
          id: string | null
          payment_method: string | null
          subcategory_id: string | null
          subtotal: number | null
          supplier_id: string | null
          tenant_id: string | null
          total: number | null
          vat: number | null
          vehicle_id: string | null
          voucher_number: string | null
          work_order_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_cost_center_fk"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "accounting_cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_department_category_fk"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_expense_category_fk"
            columns: ["expense_category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_subcategory_fk"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      reports_insurance_statement_facts_v1: {
        Row: {
          claim_id: string | null
          claim_number: string | null
          credit: number | null
          customer_id: string | null
          debit: number | null
          due_date: string | null
          insurance_company_id: string | null
          party_name: string | null
          plate: string | null
          record_id: string | null
          reference: string | null
          report_date: string | null
          running_balance: number | null
          source_rank: number | null
          status: string | null
          subtotal: number | null
          tenant_id: string | null
          transaction_type: string | null
          vat: number | null
          vehicle_id: string | null
          vehicle_name: string | null
          work_order_id: string | null
        }
        Relationships: []
      }
      reports_invoice_facts_v1: {
        Row: {
          business_type: string | null
          claim_id: string | null
          claim_number: string | null
          customer_id: string | null
          due_date: string | null
          id: string | null
          insurance_company_id: string | null
          invoice_date: string | null
          invoice_number: string | null
          outstanding: number | null
          paid: number | null
          party_name: string | null
          plate: string | null
          source_type: string | null
          status: string | null
          subtotal: number | null
          tenant_id: string | null
          total: number | null
          vat: number | null
          vehicle_id: string | null
          vehicle_name: string | null
          work_order_id: string | null
        }
        Relationships: []
      }
      reports_payment_facts_v1: {
        Row: {
          amount: number | null
          business_type: string | null
          claim_id: string | null
          claim_number: string | null
          customer_id: string | null
          id: string | null
          insurance_company_id: string | null
          invoice_id: string | null
          party_name: string | null
          payment_date: string | null
          payment_method: string | null
          payment_number: string | null
          status: string | null
          tenant_id: string | null
          vehicle_id: string | null
          work_order_id: string | null
        }
        Relationships: []
      }
      reports_work_order_facts_v1: {
        Row: {
          archived_at: string | null
          business_type: string | null
          claim_id: string | null
          claim_number: string | null
          completed_at: string | null
          created_at: string | null
          customer_id: string | null
          customer_name: string | null
          deleted_at: string | null
          delivered_at: string | null
          id: string | null
          insurance_company_id: string | null
          order_number: string | null
          plate: string | null
          received_at: string | null
          status: string | null
          tenant_id: string | null
          vehicle_id: string | null
          vehicle_name: string | null
          vin: string | null
          work_order_type: string | null
          workshop_days: number | null
        }
        Relationships: [
          {
            foreignKeyName: "job_orders_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "accounting_claims_summary_view"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "job_orders_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims_archive_report"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "job_orders_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "insurance_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoices_archive_report: {
        Row: {
          balance_due: number | null
          created_at: string | null
          customer_id: string | null
          customer_name: string | null
          date: string | null
          due_date: string | null
          invoice_id: string | null
          invoice_number: string | null
          paid_amount: number | null
          status: string | null
          subtotal: number | null
          tenant_id: string | null
          total: number | null
          updated_at: string | null
          vat: number | null
          vehicle_plate: string | null
          work_order_id: string | null
        }
        Insert: {
          balance_due?: number | null
          created_at?: string | null
          customer_id?: string | null
          customer_name?: string | null
          date?: string | null
          due_date?: string | null
          invoice_id?: string | null
          invoice_number?: string | null
          paid_amount?: number | null
          status?: string | null
          subtotal?: number | null
          tenant_id?: string | null
          total?: number | null
          updated_at?: string | null
          vat?: number | null
          vehicle_plate?: string | null
          work_order_id?: string | null
        }
        Update: {
          balance_due?: number | null
          created_at?: string | null
          customer_id?: string | null
          customer_name?: string | null
          date?: string | null
          due_date?: string | null
          invoice_id?: string | null
          invoice_number?: string | null
          paid_amount?: number | null
          status?: string | null
          subtotal?: number | null
          tenant_id?: string | null
          total?: number | null
          updated_at?: string | null
          vat?: number | null
          vehicle_plate?: string | null
          work_order_id?: string | null
        }
        Relationships: []
      }
      vehicle_duplicates: {
        Row: {
          dup_count: number | null
          plate_country: string | null
          plate_letters: string | null
          plate_number: string | null
          tenant_id: string | null
          vehicle_ids: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_identity_duplicate_report: {
        Row: {
          duplicate_count: number | null
          duplicate_key: string | null
          duplicate_type: string | null
          tenant_id: string | null
          vehicle_ids: string[] | null
        }
        Relationships: []
      }
      workshop_operations_report: {
        Row: {
          completed_at: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          entry_date: string | null
          expenses_total: number | null
          final_total: number | null
          insurance_claim_number: string | null
          insurance_company: string | null
          job_order_id: string | null
          labor_cost: number | null
          order_number: string | null
          parts_cost: number | null
          status: Database["public"]["Enums"]["job_status"] | null
          tenant_id: string | null
          updated_at: string | null
          vehicle_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_plate: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accounting_approve_opening_balance_batch: {
        Args: { p_batch_id: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          batch_number: string
          created_at: string
          created_by: string | null
          description: string | null
          fiscal_year_id: string
          id: string
          posted_at: string | null
          posted_by: string | null
          posting_journal_entry_id: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "accounting_opening_balance_batches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      accounting_assert_entry_ready: {
        Args: { p_entry_id: string; p_required_status: string }
        Returns: {
          accounting_date: string
          accounting_period_id: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          currency: string
          description_ar: string | null
          description_en: string | null
          document_date: string | null
          entry_number: string
          entry_type: string
          exchange_rate: number
          fiscal_year_id: string
          id: string
          posted_at: string | null
          posted_by: string | null
          reference: string | null
          reversal_reason: string | null
          reversed_entry_id: string | null
          source_identifier: string | null
          source_type: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "accounting_journal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      accounting_dashboard_summary_rpc: {
        Args: {
          p_from_date?: string
          p_insurance_company_id?: string
          p_to_date?: string
          p_work_type?: string
        }
        Returns: Json
      }
      accounting_get_source_posting_snapshot: {
        Args: {
          p_source_id: string
          p_source_type: string
          p_tenant_id: string
        }
        Returns: Json
      }
      accounting_get_source_posting_snapshot_phase2_core: {
        Args: {
          p_source_id: string
          p_source_type: string
          p_tenant_id: string
        }
        Returns: Json
      }
      accounting_has_permission: {
        Args: { p_permission: string }
        Returns: boolean
      }
      accounting_json_record_is_active: {
        Args: { p_record: Json }
        Returns: boolean
      }
      accounting_report_permission: {
        Args: { p_report_key: string }
        Returns: string
      }
      accounting_report_record_eligible: {
        Args: {
          p_archived_at?: string
          p_deleted_at?: string
          p_is_archived?: boolean
          p_status: string
          p_tenant_id: string
        }
        Returns: boolean
      }
      accounting_report_rpc: {
        Args: {
          p_direction?: string
          p_filters?: Json
          p_from?: string
          p_page?: number
          p_page_size?: number
          p_report_key: string
          p_search?: string
          p_sort?: string
          p_to?: string
        }
        Returns: Json
      }
      accounting_reports_summary_rpc: {
        Args: { p_from_date?: string; p_to_date?: string }
        Returns: Json
      }
      accounting_setup_readiness: { Args: never; Returns: Json }
      accounting_vehicle_profit_loss_rpc: {
        Args: {
          p_filters?: Json
          p_from?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_to?: string
        }
        Returns: Json
      }
      activate_unified_invoice_numbering: {
        Args: { p_first_sequence: number; p_padding?: number; p_year: number }
        Returns: {
          activated_at: string
          activated_by: string | null
          created_at: string
          cutover_year: number
          first_invoice_number: string | null
          first_sequence: number
          numbering_format: string
          padding: number
          prefix: string
          start_year: number | null
          starting_sequence: number | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice_numbering_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_reopen_signature: {
        Args: { p_job_order_id: string }
        Returns: Json
      }
      allocate_invoice_number_internal: {
        Args: {
          p_invoice_type: string
          p_issue_date: string
          p_issued_at: string
          p_issued_by: string
          p_source_id: string
          p_source_table: string
          p_tenant_id: string
        }
        Returns: {
          created_at: string
          id: string
          invoice_number: string
          invoice_type: string
          invoice_year: number
          issued_at: string
          issued_by: string | null
          sequence_number: number
          source_id: string
          source_table: string
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice_number_registry"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_default_expense_category_template: { Args: never; Returns: number }
      approve_accounting_journal_entry: {
        Args: { p_entry_id: string }
        Returns: {
          accounting_date: string
          accounting_period_id: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          currency: string
          description_ar: string | null
          description_en: string | null
          document_date: string | null
          entry_number: string
          entry_type: string
          exchange_rate: number
          fiscal_year_id: string
          id: string
          posted_at: string | null
          posted_by: string | null
          reference: string | null
          reversal_reason: string | null
          reversed_entry_id: string | null
          source_identifier: string | null
          source_type: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "accounting_journal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attach_user_to_staging_tenant: { Args: { _email: string }; Returns: Json }
      create_accounting_journal_entry: {
        Args: {
          p_accounting_date: string
          p_accounting_period_id: string
          p_description_ar?: string
          p_description_en?: string
          p_document_date?: string
          p_entry_type?: string
          p_fiscal_year_id: string
          p_reference?: string
          p_source_identifier?: string
          p_source_type?: string
        }
        Returns: {
          accounting_date: string
          accounting_period_id: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          currency: string
          description_ar: string | null
          description_en: string | null
          document_date: string | null
          entry_number: string
          entry_type: string
          exchange_rate: number
          fiscal_year_id: string
          id: string
          posted_at: string | null
          posted_by: string | null
          reference: string | null
          reversal_reason: string | null
          reversed_entry_id: string | null
          source_identifier: string | null
          source_type: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "accounting_journal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_customer_notification: {
        Args: {
          p_body: string
          p_channel?: string
          p_event_type: string
          p_force?: boolean
          p_job_order_id: string
          p_tenant_id: string
        }
        Returns: string
      }
      expense_has_permission: {
        Args: { p_permission: string }
        Returns: boolean
      }
      expense_management_rpc: {
        Args: { p_filters?: Json; p_page?: number; p_page_size?: number }
        Returns: Json
      }
      expense_work_order_search_rpc: {
        Args: { p_limit?: number; p_search?: string }
        Returns: Json
      }
      extract_plate_digits: { Args: { p: string }; Returns: string }
      extract_plate_letters: { Args: { p: string }; Returns: string }
      find_unified_invoice_number: {
        Args: { p_invoice_number: string }
        Returns: {
          ambiguous_historical_number: boolean
          invoice_date: string
          invoice_number: string
          invoice_type: string
          is_historical: boolean
          route: string
          source_id: string
          source_type: string
          tenant_id: string
        }[]
      }
      find_vehicle_by_plate: {
        Args: { p_country?: string; p_digits: string; p_letters: string }
        Returns: {
          archived: boolean
          brand: string
          color: string
          customer_id: string
          id: string
          model: string
          plate_country: string
          plate_letters: string
          plate_number: string
          year: number
        }[]
      }
      find_vehicle_by_vin: {
        Args: { p_vin: string }
        Returns: {
          archived: boolean
          brand: string
          color: string
          customer_id: string
          id: string
          model: string
          plate_country: string
          plate_letters: string
          plate_number: string
          year: number
        }[]
      }
      get_public_invoice: { Args: { p_token: string }; Returns: Json }
      get_public_tracking: { Args: { p_token: string }; Returns: Json }
      get_public_tracking_base_20260721: {
        Args: { p_token: string }
        Returns: Json
      }
      get_public_work_order: {
        Args: { p_key: string; p_password?: string }
        Returns: {
          access_state: string
          created_at: string
          customer_name: string
          description: string
          diagnosis: string
          entry_date: string
          id: string
          insurance_claim_number: string
          order_number: string
          requires_password: boolean
          status: string
          updated_at: string
          vehicle_brand: string
          vehicle_color: string
          vehicle_model: string
          vehicle_plate: string
          vehicle_year: number
          work_order_type: string
        }[]
      }
      get_supplement_request_by_token: {
        Args: { p_token: string }
        Returns: Json
      }
      get_user_email: { Args: never; Returns: string }
      get_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_user_tenant_id: { Args: never; Returns: string }
      get_work_order_for_sign: { Args: { p_token: string }; Returns: Json }
      get_work_order_for_sign_base_20260721: {
        Args: { p_token: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_accounting_source_eligible: {
        Args: {
          p_source_id: string
          p_source_type: string
          p_tenant_id: string
        }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      issue_sales_document_invoice: {
        Args: { p_issue_date: string; p_source_id: string }
        Returns: {
          invoice_number: string
          invoice_status: string
          issued_at: string
          source_id: string
        }[]
      }
      log_public_tracking_open: {
        Args: {
          p_result?: string
          p_short_code: string
          p_target_type?: string
          p_user_agent?: string
        }
        Returns: Json
      }
      next_accounting_journal_number: {
        Args: { p_fiscal_year_id: string }
        Returns: string
      }
      next_customer_code: {
        Args: { p_tenant_id: string; p_year?: number }
        Returns: string
      }
      next_expense_voucher_number: {
        Args: { p_padding?: number; p_prefix?: string; p_year?: number }
        Returns: string
      }
      next_vehicle_entry_number: { Args: { p_year?: number }; Returns: string }
      post_accounting_journal_entry: {
        Args: { p_entry_id: string }
        Returns: {
          accounting_date: string
          accounting_period_id: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          currency: string
          description_ar: string | null
          description_en: string | null
          document_date: string | null
          entry_number: string
          entry_type: string
          exchange_rate: number
          fiscal_year_id: string
          id: string
          posted_at: string | null
          posted_by: string | null
          reference: string | null
          reversal_reason: string | null
          reversed_entry_id: string | null
          source_identifier: string | null
          source_type: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "accounting_journal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      post_accounting_source: {
        Args: {
          p_accounting_date: string
          p_event_type: string
          p_idempotency_key: string
          p_source_id: string
          p_source_type: string
        }
        Returns: {
          accounting_date: string
          accounting_period_id: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          currency: string
          description_ar: string | null
          description_en: string | null
          document_date: string | null
          entry_number: string
          entry_type: string
          exchange_rate: number
          fiscal_year_id: string
          id: string
          posted_at: string | null
          posted_by: string | null
          reference: string | null
          reversal_reason: string | null
          reversed_entry_id: string | null
          source_identifier: string | null
          source_type: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "accounting_journal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      preview_accounting_source_posting: {
        Args: {
          p_accounting_date?: string
          p_event_type: string
          p_source_id: string
          p_source_type: string
        }
        Returns: Json
      }
      reports_aging_rpc: {
        Args: {
          p_business_type?: string
          p_direction?: string
          p_filters?: Json
          p_from_date?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_sort?: string
          p_tenant_id: string
          p_to_date?: string
        }
        Returns: Json
      }
      reports_assert_access: {
        Args: { p_permission: string; p_tenant_id: string }
        Returns: boolean
      }
      reports_center_query_rpc: {
        Args: {
          p_business_type?: string
          p_direction?: string
          p_filters?: Json
          p_from_date?: string
          p_page?: number
          p_page_size?: number
          p_report_key: string
          p_search?: string
          p_sort?: string
          p_tenant_id: string
          p_to_date?: string
        }
        Returns: Json
      }
      reports_center_secure_summary_rpc: {
        Args: {
          p_business_type?: string
          p_from_date?: string
          p_insurance_company_id?: string
          p_tenant_id: string
          p_to_date?: string
        }
        Returns: Json
      }
      reports_center_summary_rpc: {
        Args: {
          p_business_type?: string
          p_from_date?: string
          p_insurance_company_id?: string
          p_tenant_id: string
          p_to_date?: string
        }
        Returns: Json
      }
      reports_claims_register_rpc: {
        Args: {
          p_business_type?: string
          p_direction?: string
          p_filters?: Json
          p_from_date?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_sort?: string
          p_tenant_id: string
          p_to_date?: string
        }
        Returns: Json
      }
      reports_classify_business_type: {
        Args: {
          p_claim_id: string
          p_record_kind: string
          p_work_order_type?: string
        }
        Returns: string
      }
      reports_completed_without_invoice_rpc: {
        Args: {
          p_business_type?: string
          p_direction?: string
          p_filters?: Json
          p_from_date?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_sort?: string
          p_tenant_id: string
          p_to_date?: string
        }
        Returns: Json
      }
      reports_delivered_awaiting_collection_rpc: {
        Args: {
          p_business_type?: string
          p_direction?: string
          p_filters?: Json
          p_from_date?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_sort?: string
          p_tenant_id: string
          p_to_date?: string
        }
        Returns: Json
      }
      reports_expenses_rpc: {
        Args: {
          p_business_type?: string
          p_direction?: string
          p_filters?: Json
          p_from_date?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_sort?: string
          p_tenant_id: string
          p_to_date?: string
        }
        Returns: Json
      }
      reports_has_permission: {
        Args: { p_permission: string }
        Returns: boolean
      }
      reports_insurance_company_statement_rpc: {
        Args: {
          p_business_type?: string
          p_direction?: string
          p_filters?: Json
          p_from_date?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_sort?: string
          p_tenant_id: string
          p_to_date?: string
        }
        Returns: Json
      }
      reports_invoices_rpc: {
        Args: {
          p_business_type?: string
          p_direction?: string
          p_filters?: Json
          p_from_date?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_sort?: string
          p_tenant_id: string
          p_to_date?: string
        }
        Returns: Json
      }
      reports_payments_rpc: {
        Args: {
          p_business_type?: string
          p_direction?: string
          p_filters?: Json
          p_from_date?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_sort?: string
          p_tenant_id: string
          p_to_date?: string
        }
        Returns: Json
      }
      reports_permission_for_key: {
        Args: { p_report_key: string }
        Returns: string
      }
      reports_profitability_rpc: {
        Args: {
          p_business_type?: string
          p_direction?: string
          p_filters?: Json
          p_from_date?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_sort?: string
          p_tenant_id: string
          p_to_date?: string
        }
        Returns: Json
      }
      reports_secure_query_rpc: {
        Args: {
          p_business_type?: string
          p_direction?: string
          p_filters?: Json
          p_from_date?: string
          p_page?: number
          p_page_size?: number
          p_report_key: string
          p_search?: string
          p_sort?: string
          p_tenant_id: string
          p_to_date?: string
        }
        Returns: Json
      }
      reports_vehicles_in_workshop_rpc: {
        Args: {
          p_business_type?: string
          p_direction?: string
          p_filters?: Json
          p_from_date?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_sort?: string
          p_tenant_id: string
          p_to_date?: string
        }
        Returns: Json
      }
      reports_work_orders_query_v1: {
        Args: {
          p_business_type?: string
          p_direction?: string
          p_filters?: Json
          p_from_date?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_sort?: string
          p_tenant_id: string
          p_to_date?: string
        }
        Returns: Json
      }
      reports_work_orders_rpc: {
        Args: {
          p_business_type?: string
          p_direction?: string
          p_filters?: Json
          p_from_date?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_sort?: string
          p_tenant_id: string
          p_to_date?: string
        }
        Returns: Json
      }
      reserve_message_idempotency: {
        Args: {
          p_channel: string
          p_idempotency_key: string
          p_logical_action: string
          p_recipient: string
          p_tenant_id: string
        }
        Returns: {
          inserted: boolean
          message_log_id: string
          status: string
        }[]
      }
      resolve_accounting_account_mapping: {
        Args: {
          p_as_of?: string
          p_business_type?: string
          p_cost_center_id?: string
          p_department_id?: string
          p_mapping_key: string
        }
        Returns: string
      }
      resolve_tenant_by_hostname: {
        Args: { p_hostname: string }
        Returns: {
          tenant_id: string
          tenant_name: string
          tenant_slug: string
        }[]
      }
      reverse_accounting_journal_entry: {
        Args: { p_entry_id: string; p_reason: string; p_reversal_date: string }
        Returns: {
          accounting_date: string
          accounting_period_id: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          currency: string
          description_ar: string | null
          description_en: string | null
          document_date: string | null
          entry_number: string
          entry_type: string
          exchange_rate: number
          fiscal_year_id: string
          id: string
          posted_at: string | null
          posted_by: string | null
          reference: string | null
          reversal_reason: string | null
          reversed_entry_id: string | null
          source_identifier: string | null
          source_type: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "accounting_journal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reverse_accounting_source_posting: {
        Args: {
          p_reason: string
          p_reversal_date: string
          p_source_id: string
          p_source_type: string
        }
        Returns: {
          accounting_date: string
          accounting_period_id: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          currency: string
          description_ar: string | null
          description_en: string | null
          document_date: string | null
          entry_number: string
          entry_type: string
          exchange_rate: number
          fiscal_year_id: string
          id: string
          posted_at: string | null
          posted_by: string | null
          reference: string | null
          reversal_reason: string | null
          reversed_entry_id: string | null
          source_identifier: string | null
          source_type: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "accounting_journal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_portal_note: {
        Args: { p_decision: string; p_id: string }
        Returns: Json
      }
      seed_default_notification_settings: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      set_accounting_fiscal_year_status: {
        Args: { p_fiscal_year_id: string; p_reason?: string; p_status: string }
        Returns: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          name: string
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          start_date: string
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "accounting_fiscal_years"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_accounting_period_status: {
        Args: { p_period_id: string; p_reason?: string; p_status: string }
        Returns: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          end_date: string
          fiscal_year_id: string
          id: string
          name: string
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          sequence: number
          start_date: string
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "accounting_periods"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_customer_feedback: {
        Args: {
          p_comment?: string
          p_ip?: string
          p_rating: number
          p_token: string
        }
        Returns: Json
      }
      submit_portal_note: {
        Args: {
          p_customer_name?: string
          p_ip?: string
          p_note: string
          p_token: string
          p_user_agent?: string
        }
        Returns: Json
      }
      submit_supplement_decision: {
        Args: {
          p_decisions: Json
          p_ip: string
          p_signature: string
          p_signer_name?: string
          p_token: string
          p_user_agent: string
        }
        Returns: Json
      }
      submit_work_order_signature: {
        Args: {
          p_ip?: string
          p_signature: string
          p_signer_name: string
          p_token: string
          p_user_agent?: string
        }
        Returns: Json
      }
      submit_work_order_signature_base_20260721: {
        Args: {
          p_ip?: string
          p_signature: string
          p_signer_name: string
          p_token: string
          p_user_agent?: string
        }
        Returns: Json
      }
      unified_invoice_numbering_is_active: {
        Args: { p_tenant_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "manager"
        | "technician"
        | "insurance"
        | "customer"
        | "supervisor"
        | "accountant"
      claim_payment_method: "bank_transfer" | "cheque" | "offset" | "cash"
      claim_payment_status: "pending" | "cleared" | "bounced"
      claim_status: "pending" | "approved" | "rejected" | "paid" | "cancelled"
      invoice_status: "draft" | "sent" | "paid" | "overdue" | "cancelled"
      job_status:
        | "received"
        | "inspection"
        | "waiting_parts"
        | "in_progress"
        | "completed"
        | "delivered"
      subscription_plan: "free" | "basic" | "pro" | "enterprise"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "manager",
        "technician",
        "insurance",
        "customer",
        "supervisor",
        "accountant",
      ],
      claim_payment_method: ["bank_transfer", "cheque", "offset", "cash"],
      claim_payment_status: ["pending", "cleared", "bounced"],
      claim_status: ["pending", "approved", "rejected", "paid", "cancelled"],
      invoice_status: ["draft", "sent", "paid", "overdue", "cancelled"],
      job_status: [
        "received",
        "inspection",
        "waiting_parts",
        "in_progress",
        "completed",
        "delivered",
      ],
      subscription_plan: ["free", "basic", "pro", "enterprise"],
    },
  },
} as const
