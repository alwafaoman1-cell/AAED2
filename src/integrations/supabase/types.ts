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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
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
        Relationships: []
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
        }
        Relationships: []
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
            referencedRelation: "insurance_claims"
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
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
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
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
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
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
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
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
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
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
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
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          archived_at: string | null
          commercial_registration: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          id_number: string | null
          name: string
          notes: string | null
          phone: string | null
          tax_number: string | null
          tenant_id: string
          type: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          commercial_registration?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          id_number?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          tax_number?: string | null
          tenant_id: string
          type?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          commercial_registration?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          id_number?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          tax_number?: string | null
          tenant_id?: string
          type?: string
          updated_at?: string
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
      expense_categories: {
        Row: {
          active: boolean
          color: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          attachments: Json
          beneficiary: string | null
          cashbox_id: string | null
          cashbox_name: string | null
          category_id: string | null
          category_name: string | null
          created_at: string
          created_by: string | null
          date: string
          description: string | null
          id: string
          linked_vehicle_name: string | null
          linked_vehicle_plate: string | null
          linked_work_order_id: string | null
          meta: Json
          payment_method: string
          tenant_id: string
          updated_at: string
          voucher_number: string
        }
        Insert: {
          amount?: number
          attachments?: Json
          beneficiary?: string | null
          cashbox_id?: string | null
          cashbox_name?: string | null
          category_id?: string | null
          category_name?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          description?: string | null
          id?: string
          linked_vehicle_name?: string | null
          linked_vehicle_plate?: string | null
          linked_work_order_id?: string | null
          meta?: Json
          payment_method?: string
          tenant_id: string
          updated_at?: string
          voucher_number: string
        }
        Update: {
          amount?: number
          attachments?: Json
          beneficiary?: string | null
          cashbox_id?: string | null
          cashbox_name?: string | null
          category_id?: string | null
          category_name?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          description?: string | null
          id?: string
          linked_vehicle_name?: string | null
          linked_vehicle_plate?: string | null
          linked_work_order_id?: string | null
          meta?: Json
          payment_method?: string
          tenant_id?: string
          updated_at?: string
          voucher_number?: string
        }
        Relationships: []
      }
      inspections: {
        Row: {
          created_at: string
          damage_type: string | null
          id: string
          inspector_id: string | null
          job_order_id: string
          notes: string | null
          photos: string[] | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          damage_type?: string | null
          id?: string
          inspector_id?: string | null
          job_order_id: string
          notes?: string | null
          photos?: string[] | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          damage_type?: string | null
          id?: string
          inspector_id?: string | null
          job_order_id?: string
          notes?: string | null
          photos?: string[] | null
          tenant_id?: string
          updated_at?: string
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
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
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
          created_at: string
          customer_id: string
          damage_photos: string[] | null
          deductible_amount: number | null
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
          inspection_id: string | null
          insurance_company: string
          insurance_company_id: string | null
          job_order_id: string | null
          needed_parts: Json | null
          notes: string | null
          paid_at: string | null
          policy_expiry_date: string | null
          policy_number: string | null
          receiver_id_number: string | null
          receiver_id_photo: string | null
          receiver_name: string | null
          rejection_reason: string | null
          satisfaction_photos: string[] | null
          status: Database["public"]["Enums"]["claim_status"]
          tenant_id: string
          updated_at: string
          upl_items: Json | null
          vehicle_color: string | null
          vehicle_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_owner_name: string | null
          vehicle_owner_phone: string | null
          vehicle_plate: string | null
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
          created_at?: string
          customer_id: string
          damage_photos?: string[] | null
          deductible_amount?: number | null
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
          inspection_id?: string | null
          insurance_company: string
          insurance_company_id?: string | null
          job_order_id?: string | null
          needed_parts?: Json | null
          notes?: string | null
          paid_at?: string | null
          policy_expiry_date?: string | null
          policy_number?: string | null
          receiver_id_number?: string | null
          receiver_id_photo?: string | null
          receiver_name?: string | null
          rejection_reason?: string | null
          satisfaction_photos?: string[] | null
          status?: Database["public"]["Enums"]["claim_status"]
          tenant_id: string
          updated_at?: string
          upl_items?: Json | null
          vehicle_color?: string | null
          vehicle_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_owner_name?: string | null
          vehicle_owner_phone?: string | null
          vehicle_plate?: string | null
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
          created_at?: string
          customer_id?: string
          damage_photos?: string[] | null
          deductible_amount?: number | null
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
          inspection_id?: string | null
          insurance_company?: string
          insurance_company_id?: string | null
          job_order_id?: string | null
          needed_parts?: Json | null
          notes?: string | null
          paid_at?: string | null
          policy_expiry_date?: string | null
          policy_number?: string | null
          receiver_id_number?: string | null
          receiver_id_photo?: string | null
          receiver_name?: string | null
          rejection_reason?: string | null
          satisfaction_photos?: string[] | null
          status?: Database["public"]["Enums"]["claim_status"]
          tenant_id?: string
          updated_at?: string
          upl_items?: Json | null
          vehicle_color?: string | null
          vehicle_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_owner_name?: string | null
          vehicle_owner_phone?: string | null
          vehicle_plate?: string | null
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
            foreignKeyName: "insurance_claims_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
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
      insurance_companies: {
        Row: {
          address: string | null
          bank_account_name: string | null
          bank_name: string | null
          branch_city: string | null
          commercial_registration: string | null
          contact_person: string | null
          created_at: string
          default_deductible_percent: number
          email: string | null
          iban: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          notes: string | null
          payment_terms_days: number
          phone: string | null
          po_box: string | null
          tax_number: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          bank_account_name?: string | null
          bank_name?: string | null
          branch_city?: string | null
          commercial_registration?: string | null
          contact_person?: string | null
          created_at?: string
          default_deductible_percent?: number
          email?: string | null
          iban?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          notes?: string | null
          payment_terms_days?: number
          phone?: string | null
          po_box?: string | null
          tax_number?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          bank_account_name?: string | null
          bank_name?: string | null
          branch_city?: string | null
          commercial_registration?: string | null
          contact_person?: string | null
          created_at?: string
          default_deductible_percent?: number
          email?: string | null
          iban?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          notes?: string | null
          payment_terms_days?: number
          phone?: string | null
          po_box?: string | null
          tax_number?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
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
          claim_id: string | null
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
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
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
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
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
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
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
          notes: string | null
          odometer_km: number | null
          order_number: string
          tracking_expires_at: string | null
          tracking_token: string
          work_order_type: string
          parts_cost: number
          parts_needed: Json
          photos: Json
          received_at: string | null
          reception_notes: string | null
          reception_photos: Json
          service_type: string | null
          stages: Json
          status: Database["public"]["Enums"]["job_status"]
          subtotal: number | null
          technician_id: string | null
          technician_name: string | null
          tenant_id: string
          updated_at: string
          vat: number | null
          vehicle_belongings: Json
          vehicle_id: string
          work_items: Json
        }
        Insert: {
          archived_at?: string | null
          completed_at?: string | null
          created_at?: string
          customer_id: string
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
          claim_id?: string | null
          labor_cost?: number
          notes?: string | null
          odometer_km?: number | null
          order_number: string
          tracking_expires_at?: string | null
          tracking_token?: string
          work_order_type?: string
          parts_cost?: number
          parts_needed?: Json
          photos?: Json
          received_at?: string | null
          reception_notes?: string | null
          reception_photos?: Json
          service_type?: string | null
          stages?: Json
          status?: Database["public"]["Enums"]["job_status"]
          subtotal?: number | null
          technician_id?: string | null
          technician_name?: string | null
          tenant_id: string
          updated_at?: string
          vat?: number | null
          vehicle_belongings?: Json
          vehicle_id: string
          work_items?: Json
        }
        Update: {
          archived_at?: string | null
          completed_at?: string | null
          created_at?: string
          customer_id?: string
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
          claim_id?: string | null
          labor_cost?: number
          notes?: string | null
          odometer_km?: number | null
          order_number?: string
          tracking_expires_at?: string | null
          tracking_token?: string
          work_order_type?: string
          parts_cost?: number
          parts_needed?: Json
          photos?: Json
          received_at?: string | null
          reception_notes?: string | null
          reception_photos?: Json
          service_type?: string | null
          stages?: Json
          status?: Database["public"]["Enums"]["job_status"]
          subtotal?: number | null
          technician_id?: string | null
          technician_name?: string | null
          tenant_id?: string
          updated_at?: string
          vat?: number | null
          vehicle_belongings?: Json
          vehicle_id?: string
          work_items?: Json
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
            foreignKeyName: "job_orders_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
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
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
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
      sales_documents: {
        Row: {
          balance_due: number
          converted_invoice_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          date: string
          discount_total: number
          doc_number: string
          doc_type: string
          due_date: string | null
          id: string
          items: Json
          last_payment_date: string | null
          notes: string | null
          paid_amount: number
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
          balance_due?: number
          converted_invoice_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          date?: string
          discount_total?: number
          doc_number: string
          doc_type?: string
          due_date?: string | null
          id?: string
          items?: Json
          last_payment_date?: string | null
          notes?: string | null
          paid_amount?: number
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
          balance_due?: number
          converted_invoice_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          date?: string
          discount_total?: number
          doc_number?: string
          doc_type?: string
          due_date?: string | null
          id?: string
          items?: Json
          last_payment_date?: string | null
          notes?: string | null
          paid_amount?: number
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
        ]
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
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
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
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
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
      tenant_integrations: {
        Row: {
          config: Json
          created_at: string
          enabled: boolean
          id: string
          last_test_at: string | null
          last_test_error: string | null
          last_test_status: string | null
          provider: string
          secrets: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_status?: string | null
          provider: string
          secrets?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_status?: string | null
          provider?: string
          secrets?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
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
          id: string
          is_active: boolean
          name: string
          subscription_plan: Database["public"]["Enums"]["subscription_plan"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
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
      vehicles: {
        Row: {
          archived: boolean
          archived_at: string | null
          archived_reason: string | null
          brand: string
          color: string | null
          created_at: string
          customer_id: string
          id: string
          mileage: number | null
          model: string
          plate_country: string
          plate_letters: string | null
          plate_number: string
          tenant_id: string
          updated_at: string
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
          id?: string
          mileage?: number | null
          model: string
          plate_country?: string
          plate_letters?: string | null
          plate_number: string
          tenant_id: string
          updated_at?: string
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
          id?: string
          mileage?: number | null
          model?: string
          plate_country?: string
          plate_letters?: string | null
          plate_number?: string
          tenant_id?: string
          updated_at?: string
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
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
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
    }
    Functions: {
      admin_reopen_signature: {
        Args: { p_job_order_id: string }
        Returns: Json
      }
      attach_user_to_staging_tenant: { Args: { _email: string }; Returns: Json }
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
      extract_plate_digits: { Args: { p: string }; Returns: string }
      extract_plate_letters: { Args: { p: string }; Returns: string }
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
      get_public_invoice: { Args: { p_token: string }; Returns: Json }
      get_public_tracking: { Args: { p_token: string }; Returns: Json }
      get_public_work_order: {
        Args: { p_key: string; p_password?: string }
        Returns: {
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      review_portal_note: {
        Args: { p_decision: string; p_id: string }
        Returns: Json
      }
      seed_default_notification_settings: {
        Args: { p_tenant_id: string }
        Returns: undefined
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
    }
    Enums: {
      app_role:
        | "admin"
        | "manager"
        | "technician"
        | "insurance"
        | "customer"
        | "supervisor"
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
