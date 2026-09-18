export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  _analytics: {
    Tables: {
      alert_queries: {
        Row: {
          cron: string | null
          description: string | null
          id: number
          inserted_at: string
          language: string | null
          name: string | null
          query: string | null
          slack_hook_url: string | null
          source_mapping: Json | null
          token: string | null
          updated_at: string
          user_id: number | null
          webhook_notification_url: string | null
        }
        Insert: {
          cron?: string | null
          description?: string | null
          id?: number
          inserted_at: string
          language?: string | null
          name?: string | null
          query?: string | null
          slack_hook_url?: string | null
          source_mapping?: Json | null
          token?: string | null
          updated_at: string
          user_id?: number | null
          webhook_notification_url?: string | null
        }
        Update: {
          cron?: string | null
          description?: string | null
          id?: number
          inserted_at?: string
          language?: string | null
          name?: string | null
          query?: string | null
          slack_hook_url?: string | null
          source_mapping?: Json | null
          token?: string | null
          updated_at?: string
          user_id?: number | null
          webhook_notification_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_queries_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_queries_backends: {
        Row: {
          alert_query_id: number | null
          backend_id: number | null
          id: number
        }
        Insert: {
          alert_query_id?: number | null
          backend_id?: number | null
          id?: number
        }
        Update: {
          alert_query_id?: number | null
          backend_id?: number | null
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "alert_queries_backends_alert_query_id_fkey"
            columns: ["alert_query_id"]
            referencedRelation: "alert_queries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_queries_backends_backend_id_fkey"
            columns: ["backend_id"]
            referencedRelation: "backends"
            referencedColumns: ["id"]
          },
        ]
      }
      backends: {
        Row: {
          config: Json | null
          config_encrypted: string | null
          default_ingest: boolean | null
          description: string | null
          id: number
          inserted_at: string
          metadata: Json | null
          name: string | null
          token: string
          type: string | null
          updated_at: string
          user_id: number | null
        }
        Insert: {
          config?: Json | null
          config_encrypted?: string | null
          default_ingest?: boolean | null
          description?: string | null
          id?: number
          inserted_at: string
          metadata?: Json | null
          name?: string | null
          token: string
          type?: string | null
          updated_at: string
          user_id?: number | null
        }
        Update: {
          config?: Json | null
          config_encrypted?: string | null
          default_ingest?: boolean | null
          description?: string | null
          id?: number
          inserted_at?: string
          metadata?: Json | null
          name?: string | null
          token?: string
          type?: string | null
          updated_at?: string
          user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "backends_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_accounts: {
        Row: {
          custom_invoice_fields: Json[] | null
          default_payment_method: string | null
          id: number
          inserted_at: string
          latest_successful_stripe_session: Json | null
          lifetime_plan: boolean
          lifetime_plan_invoice: string | null
          "lifetime_plan?": boolean | null
          stripe_customer: string | null
          stripe_invoices: Json | null
          stripe_subscriptions: Json | null
          updated_at: string
          user_id: number | null
        }
        Insert: {
          custom_invoice_fields?: Json[] | null
          default_payment_method?: string | null
          id?: number
          inserted_at: string
          latest_successful_stripe_session?: Json | null
          lifetime_plan?: boolean
          lifetime_plan_invoice?: string | null
          "lifetime_plan?"?: boolean | null
          stripe_customer?: string | null
          stripe_invoices?: Json | null
          stripe_subscriptions?: Json | null
          updated_at: string
          user_id?: number | null
        }
        Update: {
          custom_invoice_fields?: Json[] | null
          default_payment_method?: string | null
          id?: number
          inserted_at?: string
          latest_successful_stripe_session?: Json | null
          lifetime_plan?: boolean
          lifetime_plan_invoice?: string | null
          "lifetime_plan?"?: boolean | null
          stripe_customer?: string | null
          stripe_invoices?: Json | null
          stripe_subscriptions?: Json | null
          updated_at?: string
          user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_accounts_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_counts: {
        Row: {
          count: number | null
          id: number
          inserted_at: string
          node: string | null
          source_id: number | null
          updated_at: string
          user_id: number | null
        }
        Insert: {
          count?: number | null
          id?: number
          inserted_at: string
          node?: string | null
          source_id?: number | null
          updated_at: string
          user_id?: number | null
        }
        Update: {
          count?: number | null
          id?: number
          inserted_at?: string
          node?: string | null
          source_id?: number | null
          updated_at?: string
          user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_counts_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      endpoint_queries: {
        Row: {
          backend_id: number | null
          cache_duration_seconds: number | null
          description: string | null
          enable_auth: boolean | null
          id: number
          inserted_at: string
          labels: string | null
          language: string
          max_limit: number | null
          name: string | null
          proactive_requerying_seconds: number | null
          query: string | null
          redact_pii: boolean
          sandbox_query_id: number | null
          sandboxable: boolean | null
          source_mapping: Json
          token: string | null
          updated_at: string
          user_id: number | null
        }
        Insert: {
          backend_id?: number | null
          cache_duration_seconds?: number | null
          description?: string | null
          enable_auth?: boolean | null
          id?: number
          inserted_at: string
          labels?: string | null
          language: string
          max_limit?: number | null
          name?: string | null
          proactive_requerying_seconds?: number | null
          query?: string | null
          redact_pii?: boolean
          sandbox_query_id?: number | null
          sandboxable?: boolean | null
          source_mapping?: Json
          token?: string | null
          updated_at: string
          user_id?: number | null
        }
        Update: {
          backend_id?: number | null
          cache_duration_seconds?: number | null
          description?: string | null
          enable_auth?: boolean | null
          id?: number
          inserted_at?: string
          labels?: string | null
          language?: string
          max_limit?: number | null
          name?: string | null
          proactive_requerying_seconds?: number | null
          query?: string | null
          redact_pii?: boolean
          sandbox_query_id?: number | null
          sandboxable?: boolean | null
          source_mapping?: Json
          token?: string | null
          updated_at?: string
          user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "endpoint_queries_backend_id_fkey"
            columns: ["backend_id"]
            referencedRelation: "backends"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_queries_sandbox_query_id_fkey"
            columns: ["sandbox_query_id"]
            referencedRelation: "endpoint_queries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_queries_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      log_events_227cb353_7526_4ab8_8d43_2fd759b02b75: {
        Row: {
          body: Json | null
          event_message: string | null
          id: string
          timestamp: string | null
        }
        Insert: {
          body?: Json | null
          event_message?: string | null
          id: string
          timestamp?: string | null
        }
        Update: {
          body?: Json | null
          event_message?: string | null
          id?: string
          timestamp?: string | null
        }
        Relationships: []
      }
      log_events_4e208327_c7bf_49dd_a80c_359937feedfb: {
        Row: {
          body: Json | null
          event_message: string | null
          id: string
          timestamp: string | null
        }
        Insert: {
          body?: Json | null
          event_message?: string | null
          id: string
          timestamp?: string | null
        }
        Update: {
          body?: Json | null
          event_message?: string | null
          id?: string
          timestamp?: string | null
        }
        Relationships: []
      }
      log_events_5661a03a_db61_467c_8240_df509846cdd8: {
        Row: {
          body: Json | null
          event_message: string | null
          id: string
          timestamp: string | null
        }
        Insert: {
          body?: Json | null
          event_message?: string | null
          id: string
          timestamp?: string | null
        }
        Update: {
          body?: Json | null
          event_message?: string | null
          id?: string
          timestamp?: string | null
        }
        Relationships: []
      }
      log_events_86e46fa1_6544_45d4_9d7d_bccfc0c400df: {
        Row: {
          body: Json | null
          event_message: string | null
          id: string
          timestamp: string | null
        }
        Insert: {
          body?: Json | null
          event_message?: string | null
          id: string
          timestamp?: string | null
        }
        Update: {
          body?: Json | null
          event_message?: string | null
          id?: string
          timestamp?: string | null
        }
        Relationships: []
      }
      log_events_8a39c50b_e689_4472_86bb_40f776e65d5b: {
        Row: {
          body: Json | null
          event_message: string | null
          id: string
          timestamp: string | null
        }
        Insert: {
          body?: Json | null
          event_message?: string | null
          id: string
          timestamp?: string | null
        }
        Update: {
          body?: Json | null
          event_message?: string | null
          id?: string
          timestamp?: string | null
        }
        Relationships: []
      }
      log_events_c3c0713d_50d6_4de8_b40a_1857d6c50886: {
        Row: {
          body: Json | null
          event_message: string | null
          id: string
          timestamp: string | null
        }
        Insert: {
          body?: Json | null
          event_message?: string | null
          id: string
          timestamp?: string | null
        }
        Update: {
          body?: Json | null
          event_message?: string | null
          id?: string
          timestamp?: string | null
        }
        Relationships: []
      }
      log_events_cd74958d_d1db_40bb_80a4_695e2c6b1574: {
        Row: {
          body: Json | null
          event_message: string | null
          id: string
          timestamp: string | null
        }
        Insert: {
          body?: Json | null
          event_message?: string | null
          id: string
          timestamp?: string | null
        }
        Update: {
          body?: Json | null
          event_message?: string | null
          id?: string
          timestamp?: string | null
        }
        Relationships: []
      }
      log_events_dbba075b_88fc_4849_a89c_5bd2b388816c: {
        Row: {
          body: Json | null
          event_message: string | null
          id: string
          timestamp: string | null
        }
        Insert: {
          body?: Json | null
          event_message?: string | null
          id: string
          timestamp?: string | null
        }
        Update: {
          body?: Json | null
          event_message?: string | null
          id?: string
          timestamp?: string | null
        }
        Relationships: []
      }
      log_events_f71661ad_eba4_40ae_ae4d_d3a8e1539083: {
        Row: {
          body: Json | null
          event_message: string | null
          id: string
          timestamp: string | null
        }
        Insert: {
          body?: Json | null
          event_message?: string | null
          id: string
          timestamp?: string | null
        }
        Update: {
          body?: Json | null
          event_message?: string | null
          id?: string
          timestamp?: string | null
        }
        Relationships: []
      }
      oauth_access_grants: {
        Row: {
          application_id: number | null
          expires_in: number
          id: number
          inserted_at: string
          redirect_uri: string
          resource_owner_id: number
          revoked_at: string | null
          scopes: string | null
          token: string
        }
        Insert: {
          application_id?: number | null
          expires_in: number
          id?: number
          inserted_at: string
          redirect_uri: string
          resource_owner_id: number
          revoked_at?: string | null
          scopes?: string | null
          token: string
        }
        Update: {
          application_id?: number | null
          expires_in?: number
          id?: number
          inserted_at?: string
          redirect_uri?: string
          resource_owner_id?: number
          revoked_at?: string | null
          scopes?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_access_grants_application_id_fkey"
            columns: ["application_id"]
            referencedRelation: "oauth_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_access_tokens: {
        Row: {
          application_id: number | null
          description: string | null
          expires_in: number | null
          id: number
          inserted_at: string
          previous_refresh_token: string
          refresh_token: string | null
          resource_owner_id: number | null
          revoked_at: string | null
          scopes: string | null
          token: string
          updated_at: string
        }
        Insert: {
          application_id?: number | null
          description?: string | null
          expires_in?: number | null
          id?: number
          inserted_at: string
          previous_refresh_token?: string
          refresh_token?: string | null
          resource_owner_id?: number | null
          revoked_at?: string | null
          scopes?: string | null
          token: string
          updated_at: string
        }
        Update: {
          application_id?: number | null
          description?: string | null
          expires_in?: number | null
          id?: number
          inserted_at?: string
          previous_refresh_token?: string
          refresh_token?: string | null
          resource_owner_id?: number | null
          revoked_at?: string | null
          scopes?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_access_tokens_application_id_fkey"
            columns: ["application_id"]
            referencedRelation: "oauth_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_applications: {
        Row: {
          id: number
          inserted_at: string
          name: string
          owner_id: number
          redirect_uri: string
          scopes: string
          secret: string
          uid: string
          updated_at: string
        }
        Insert: {
          id?: number
          inserted_at: string
          name: string
          owner_id: number
          redirect_uri: string
          scopes?: string
          secret?: string
          uid: string
          updated_at: string
        }
        Update: {
          id?: number
          inserted_at?: string
          name?: string
          owner_id?: number
          redirect_uri?: string
          scopes?: string
          secret?: string
          uid?: string
          updated_at?: string
        }
        Relationships: []
      }
      partner_users: {
        Row: {
          id: number
          partner_id: number | null
          upgraded: boolean
          user_id: number | null
        }
        Insert: {
          id?: number
          partner_id?: number | null
          upgraded?: boolean
          user_id?: number | null
        }
        Update: {
          id?: number
          partner_id?: number | null
          upgraded?: boolean
          user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_users_partner_id_fkey"
            columns: ["partner_id"]
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_users_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          id: number
          name: string | null
          token: string | null
        }
        Insert: {
          id?: number
          name?: string | null
          token?: string | null
        }
        Update: {
          id?: number
          name?: string | null
          token?: string | null
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          brand: string | null
          customer_id: string | null
          exp_month: number | null
          exp_year: number | null
          id: number
          inserted_at: string
          last_four: string | null
          price_id: string | null
          stripe_id: string | null
          updated_at: string
        }
        Insert: {
          brand?: string | null
          customer_id?: string | null
          exp_month?: number | null
          exp_year?: number | null
          id?: number
          inserted_at: string
          last_four?: string | null
          price_id?: string | null
          stripe_id?: string | null
          updated_at: string
        }
        Update: {
          brand?: string | null
          customer_id?: string | null
          exp_month?: number | null
          exp_year?: number | null
          id?: number
          inserted_at?: string
          last_four?: string | null
          price_id?: string | null
          stripe_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_customer_id_fkey"
            columns: ["customer_id"]
            referencedRelation: "billing_accounts"
            referencedColumns: ["stripe_customer"]
          },
        ]
      }
      plans: {
        Row: {
          id: number
          inserted_at: string
          limit_alert_freq: number | null
          limit_rate_limit: number | null
          limit_saved_search_limit: number | null
          limit_source_fields_limit: number | null
          limit_source_rate_limit: number | null
          limit_source_ttl: number | null
          limit_sources: number | null
          limit_team_users_limit: number | null
          name: string | null
          period: string | null
          price: number | null
          stripe_id: string | null
          type: string | null
          updated_at: string
        }
        Insert: {
          id?: number
          inserted_at: string
          limit_alert_freq?: number | null
          limit_rate_limit?: number | null
          limit_saved_search_limit?: number | null
          limit_source_fields_limit?: number | null
          limit_source_rate_limit?: number | null
          limit_source_ttl?: number | null
          limit_sources?: number | null
          limit_team_users_limit?: number | null
          name?: string | null
          period?: string | null
          price?: number | null
          stripe_id?: string | null
          type?: string | null
          updated_at: string
        }
        Update: {
          id?: number
          inserted_at?: string
          limit_alert_freq?: number | null
          limit_rate_limit?: number | null
          limit_saved_search_limit?: number | null
          limit_source_fields_limit?: number | null
          limit_source_rate_limit?: number | null
          limit_source_ttl?: number | null
          limit_sources?: number | null
          limit_team_users_limit?: number | null
          name?: string | null
          period?: string | null
          price?: number | null
          stripe_id?: string | null
          type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rules: {
        Row: {
          backend_id: number | null
          id: number
          inserted_at: string
          lql_filters: string
          lql_string: string
          regex: string | null
          regex_struct: string | null
          sink: string | null
          source_id: number
          token: string | null
          updated_at: string
        }
        Insert: {
          backend_id?: number | null
          id?: number
          inserted_at: string
          lql_filters?: string
          lql_string?: string
          regex?: string | null
          regex_struct?: string | null
          sink?: string | null
          source_id: number
          token?: string | null
          updated_at: string
        }
        Update: {
          backend_id?: number | null
          id?: number
          inserted_at?: string
          lql_filters?: string
          lql_string?: string
          regex?: string | null
          regex_struct?: string | null
          sink?: string | null
          source_id?: number
          token?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rules_backend_id_fkey"
            columns: ["backend_id"]
            referencedRelation: "backends"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rules_sink_fkey"
            columns: ["sink"]
            referencedRelation: "sources"
            referencedColumns: ["token"]
          },
          {
            foreignKeyName: "rules_source_id_fkey"
            columns: ["source_id"]
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_search_counters: {
        Row: {
          granularity: string
          id: number
          non_tailing_count: number | null
          saved_search_id: number
          tailing_count: number | null
          timestamp: string
        }
        Insert: {
          granularity?: string
          id?: number
          non_tailing_count?: number | null
          saved_search_id: number
          tailing_count?: number | null
          timestamp: string
        }
        Update: {
          granularity?: string
          id?: number
          non_tailing_count?: number | null
          saved_search_id?: number
          tailing_count?: number | null
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_search_counters_saved_search_id_fkey"
            columns: ["saved_search_id"]
            referencedRelation: "saved_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_searches: {
        Row: {
          id: number
          inserted_at: string
          lql_charts: Json | null
          lql_filters: Json | null
          querystring: string | null
          saved_by_user: boolean | null
          source_id: number | null
          tailing: boolean
          "tailing?": boolean
          updated_at: string
        }
        Insert: {
          id?: number
          inserted_at: string
          lql_charts?: Json | null
          lql_filters?: Json | null
          querystring?: string | null
          saved_by_user?: boolean | null
          source_id?: number | null
          tailing?: boolean
          "tailing?"?: boolean
          updated_at: string
        }
        Update: {
          id?: number
          inserted_at?: string
          lql_charts?: Json | null
          lql_filters?: Json | null
          querystring?: string | null
          saved_by_user?: boolean | null
          source_id?: number | null
          tailing?: boolean
          "tailing?"?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_searches_source_id_fkey"
            columns: ["source_id"]
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      schema_migrations: {
        Row: {
          inserted_at: string | null
          version: number
        }
        Insert: {
          inserted_at?: string | null
          version: number
        }
        Update: {
          inserted_at?: string | null
          version?: number
        }
        Relationships: []
      }
      source_backends: {
        Row: {
          config: Json | null
          id: number
          inserted_at: string
          source_id: number | null
          type: string | null
          updated_at: string
        }
        Insert: {
          config?: Json | null
          id?: number
          inserted_at: string
          source_id?: number | null
          type?: string | null
          updated_at: string
        }
        Update: {
          config?: Json | null
          id?: number
          inserted_at?: string
          source_id?: number | null
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_backends_source_id_fkey"
            columns: ["source_id"]
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      source_schemas: {
        Row: {
          bigquery_schema: string | null
          id: number
          inserted_at: string
          schema_flat_map: string | null
          source_id: number | null
          updated_at: string
        }
        Insert: {
          bigquery_schema?: string | null
          id?: number
          inserted_at: string
          schema_flat_map?: string | null
          source_id?: number | null
          updated_at: string
        }
        Update: {
          bigquery_schema?: string | null
          id?: number
          inserted_at?: string
          schema_flat_map?: string | null
          source_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_schemas_source_id_fkey"
            columns: ["source_id"]
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          api_quota: number
          bigquery_clustering_fields: string | null
          bigquery_schema: string | null
          bigquery_table_ttl: number | null
          bq_storage_write_api: boolean | null
          bq_table_partition_type: string | null
          custom_event_message_keys: string | null
          default_ingest_backend_enabled: boolean | null
          disable_tailing: boolean | null
          drop_lql_filters: string
          drop_lql_string: string | null
          favorite: boolean
          id: number
          inserted_at: string
          lock_schema: boolean | null
          log_events_updated_at: string | null
          name: string | null
          notifications: Json
          notifications_every: number | null
          public_token: string | null
          service_name: string | null
          slack_hook_url: string | null
          suggested_keys: string | null
          token: string
          transform_copy_fields: string | null
          updated_at: string
          user_id: number
          v2_pipeline: boolean | null
          validate_schema: boolean | null
          webhook_notification_url: string | null
        }
        Insert: {
          api_quota?: number
          bigquery_clustering_fields?: string | null
          bigquery_schema?: string | null
          bigquery_table_ttl?: number | null
          bq_storage_write_api?: boolean | null
          bq_table_partition_type?: string | null
          custom_event_message_keys?: string | null
          default_ingest_backend_enabled?: boolean | null
          disable_tailing?: boolean | null
          drop_lql_filters?: string
          drop_lql_string?: string | null
          favorite?: boolean
          id?: number
          inserted_at: string
          lock_schema?: boolean | null
          log_events_updated_at?: string | null
          name?: string | null
          notifications?: Json
          notifications_every?: number | null
          public_token?: string | null
          service_name?: string | null
          slack_hook_url?: string | null
          suggested_keys?: string | null
          token: string
          transform_copy_fields?: string | null
          updated_at: string
          user_id: number
          v2_pipeline?: boolean | null
          validate_schema?: boolean | null
          webhook_notification_url?: string | null
        }
        Update: {
          api_quota?: number
          bigquery_clustering_fields?: string | null
          bigquery_schema?: string | null
          bigquery_table_ttl?: number | null
          bq_storage_write_api?: boolean | null
          bq_table_partition_type?: string | null
          custom_event_message_keys?: string | null
          default_ingest_backend_enabled?: boolean | null
          disable_tailing?: boolean | null
          drop_lql_filters?: string
          drop_lql_string?: string | null
          favorite?: boolean
          id?: number
          inserted_at?: string
          lock_schema?: boolean | null
          log_events_updated_at?: string | null
          name?: string | null
          notifications?: Json
          notifications_every?: number | null
          public_token?: string | null
          service_name?: string | null
          slack_hook_url?: string | null
          suggested_keys?: string | null
          token?: string
          transform_copy_fields?: string | null
          updated_at?: string
          user_id?: number
          v2_pipeline?: boolean | null
          validate_schema?: boolean | null
          webhook_notification_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sources_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sources_backends: {
        Row: {
          backend_id: number | null
          id: number
          source_id: number | null
        }
        Insert: {
          backend_id?: number | null
          id?: number
          source_id?: number | null
        }
        Update: {
          backend_id?: number | null
          id?: number
          source_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sources_backends_backend_id_fkey"
            columns: ["backend_id"]
            referencedRelation: "backends"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sources_backends_source_id_fkey"
            columns: ["source_id"]
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      system_metrics: {
        Row: {
          all_logs_logged: number | null
          id: number
          inserted_at: string
          node: string | null
          updated_at: string
        }
        Insert: {
          all_logs_logged?: number | null
          id?: number
          inserted_at: string
          node?: string | null
          updated_at: string
        }
        Update: {
          all_logs_logged?: number | null
          id?: number
          inserted_at?: string
          node?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      team_users: {
        Row: {
          email: string | null
          email_me_product: boolean
          email_preferred: string | null
          id: number
          image: string | null
          inserted_at: string
          name: string | null
          phone: string | null
          preferences: Json | null
          provider: string | null
          provider_uid: string | null
          team_id: number | null
          token: string | null
          updated_at: string
          valid_google_account: boolean
        }
        Insert: {
          email?: string | null
          email_me_product?: boolean
          email_preferred?: string | null
          id?: number
          image?: string | null
          inserted_at: string
          name?: string | null
          phone?: string | null
          preferences?: Json | null
          provider?: string | null
          provider_uid?: string | null
          team_id?: number | null
          token?: string | null
          updated_at: string
          valid_google_account?: boolean
        }
        Update: {
          email?: string | null
          email_me_product?: boolean
          email_preferred?: string | null
          id?: number
          image?: string | null
          inserted_at?: string
          name?: string | null
          phone?: string | null
          preferences?: Json | null
          provider?: string | null
          provider_uid?: string | null
          team_id?: number | null
          token?: string | null
          updated_at?: string
          valid_google_account?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "team_users_team_id_fkey"
            columns: ["team_id"]
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          id: number
          inserted_at: string
          name: string | null
          token: string | null
          updated_at: string
          user_id: number | null
        }
        Insert: {
          id?: number
          inserted_at: string
          name?: string | null
          token?: string | null
          updated_at: string
          user_id?: number | null
        }
        Update: {
          id?: number
          inserted_at?: string
          name?: string | null
          token?: string | null
          updated_at?: string
          user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          admin: boolean
          api_key: string
          api_quota: number
          bigquery_dataset_id: string | null
          bigquery_dataset_location: string | null
          bigquery_enable_managed_service_accounts: boolean | null
          bigquery_processed_bytes_limit: number
          bigquery_project_id: string | null
          bigquery_reservation_alerts: string | null
          bigquery_reservation_search: string | null
          bigquery_udfs_hash: string
          billing_enabled: boolean
          "billing_enabled?": boolean
          company: string | null
          email: string | null
          email_me_product: boolean
          email_preferred: string | null
          endpoints_beta: boolean | null
          id: number
          image: string | null
          inserted_at: string
          metadata: Json | null
          name: string | null
          old_api_key: string | null
          partner_id: number | null
          partner_upgraded: boolean | null
          phone: string | null
          preferences: Json | null
          provider: string
          provider_uid: string
          token: string
          updated_at: string
          valid_google_account: boolean | null
        }
        Insert: {
          admin?: boolean
          api_key: string
          api_quota?: number
          bigquery_dataset_id?: string | null
          bigquery_dataset_location?: string | null
          bigquery_enable_managed_service_accounts?: boolean | null
          bigquery_processed_bytes_limit?: number
          bigquery_project_id?: string | null
          bigquery_reservation_alerts?: string | null
          bigquery_reservation_search?: string | null
          bigquery_udfs_hash?: string
          billing_enabled?: boolean
          "billing_enabled?"?: boolean
          company?: string | null
          email?: string | null
          email_me_product?: boolean
          email_preferred?: string | null
          endpoints_beta?: boolean | null
          id?: number
          image?: string | null
          inserted_at: string
          metadata?: Json | null
          name?: string | null
          old_api_key?: string | null
          partner_id?: number | null
          partner_upgraded?: boolean | null
          phone?: string | null
          preferences?: Json | null
          provider: string
          provider_uid: string
          token: string
          updated_at: string
          valid_google_account?: boolean | null
        }
        Update: {
          admin?: boolean
          api_key?: string
          api_quota?: number
          bigquery_dataset_id?: string | null
          bigquery_dataset_location?: string | null
          bigquery_enable_managed_service_accounts?: boolean | null
          bigquery_processed_bytes_limit?: number
          bigquery_project_id?: string | null
          bigquery_reservation_alerts?: string | null
          bigquery_reservation_search?: string | null
          bigquery_udfs_hash?: string
          billing_enabled?: boolean
          "billing_enabled?"?: boolean
          company?: string | null
          email?: string | null
          email_me_product?: boolean
          email_preferred?: string | null
          endpoints_beta?: boolean | null
          id?: number
          image?: string | null
          inserted_at?: string
          metadata?: Json | null
          name?: string | null
          old_api_key?: string | null
          partner_id?: number | null
          partner_upgraded?: boolean | null
          phone?: string | null
          preferences?: Json | null
          provider?: string
          provider_uid?: string
          token?: string
          updated_at?: string
          valid_google_account?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "users_partner_id_fkey"
            columns: ["partner_id"]
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      vercel_auths: {
        Row: {
          access_token: string | null
          id: number
          inserted_at: string
          installation_id: string | null
          team_id: string | null
          token_type: string | null
          updated_at: string
          user_id: number | null
          vercel_user_id: string | null
        }
        Insert: {
          access_token?: string | null
          id?: number
          inserted_at: string
          installation_id?: string | null
          team_id?: string | null
          token_type?: string | null
          updated_at: string
          user_id?: number | null
          vercel_user_id?: string | null
        }
        Update: {
          access_token?: string | null
          id?: number
          inserted_at?: string
          installation_id?: string | null
          team_id?: string | null
          token_type?: string | null
          updated_at?: string
          user_id?: number | null
          vercel_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vercel_auths_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_logs: {
        Args: { days_to_keep?: number; max_table_size_mb?: number }
        Returns: {
          deleted_rows: number
          reason: string
          table_name: string
          table_size_mb: number
        }[]
      }
      show_table_sizes: {
        Args: { max_table_size_mb?: number }
        Returns: {
          row_count: number
          size_mb: number
          status: string
          table_name: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  _realtime: {
    Tables: {
      extensions: {
        Row: {
          id: string
          inserted_at: string
          settings: Json | null
          tenant_external_id: string | null
          type: string | null
          updated_at: string
        }
        Insert: {
          id: string
          inserted_at: string
          settings?: Json | null
          tenant_external_id?: string | null
          type?: string | null
          updated_at: string
        }
        Update: {
          id?: string
          inserted_at?: string
          settings?: Json | null
          tenant_external_id?: string | null
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "extensions_tenant_external_id_fkey"
            columns: ["tenant_external_id"]
            referencedRelation: "tenants"
            referencedColumns: ["external_id"]
          },
        ]
      }
      schema_migrations: {
        Row: {
          inserted_at: string | null
          version: number
        }
        Insert: {
          inserted_at?: string | null
          version: number
        }
        Update: {
          inserted_at?: string | null
          version?: number
        }
        Relationships: []
      }
      tenants: {
        Row: {
          broadcast_adapter: string | null
          external_id: string | null
          id: string
          inserted_at: string
          jwt_jwks: Json | null
          jwt_secret: string | null
          max_bytes_per_second: number
          max_channels_per_client: number
          max_concurrent_users: number
          max_events_per_second: number
          max_joins_per_second: number
          max_payload_size_in_kb: number | null
          max_presence_events_per_second: number | null
          migrations_ran: number | null
          name: string | null
          notify_private_alpha: boolean | null
          postgres_cdc_default: string | null
          private_only: boolean
          suspend: boolean | null
          updated_at: string
        }
        Insert: {
          broadcast_adapter?: string | null
          external_id?: string | null
          id: string
          inserted_at: string
          jwt_jwks?: Json | null
          jwt_secret?: string | null
          max_bytes_per_second?: number
          max_channels_per_client?: number
          max_concurrent_users?: number
          max_events_per_second?: number
          max_joins_per_second?: number
          max_payload_size_in_kb?: number | null
          max_presence_events_per_second?: number | null
          migrations_ran?: number | null
          name?: string | null
          notify_private_alpha?: boolean | null
          postgres_cdc_default?: string | null
          private_only?: boolean
          suspend?: boolean | null
          updated_at: string
        }
        Update: {
          broadcast_adapter?: string | null
          external_id?: string | null
          id?: string
          inserted_at?: string
          jwt_jwks?: Json | null
          jwt_secret?: string | null
          max_bytes_per_second?: number
          max_channels_per_client?: number
          max_concurrent_users?: number
          max_events_per_second?: number
          max_joins_per_second?: number
          max_payload_size_in_kb?: number | null
          max_presence_events_per_second?: number | null
          migrations_ran?: number | null
          name?: string | null
          notify_private_alpha?: boolean | null
          postgres_cdc_default?: string | null
          private_only?: boolean
          suspend?: boolean | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  auth: {
    Tables: {
      audit_log_entries: {
        Row: {
          created_at: string | null
          id: string
          instance_id: string | null
          ip_address: string
          payload: Json | null
        }
        Insert: {
          created_at?: string | null
          id: string
          instance_id?: string | null
          ip_address?: string
          payload?: Json | null
        }
        Update: {
          created_at?: string | null
          id?: string
          instance_id?: string | null
          ip_address?: string
          payload?: Json | null
        }
        Relationships: []
      }
      config_settings: {
        Row: {
          created_at: string
          id: string
          is_secret: boolean
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_secret?: boolean
          key: string
          updated_at?: string
          value?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_secret?: boolean
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      custom_oauth_providers: {
        Row: {
          acceptable_client_ids: string[]
          attribute_mapping: Json
          authorization_params: Json
          authorization_url: string | null
          cached_discovery: Json | null
          client_id: string
          client_secret: string
          created_at: string
          discovery_cached_at: string | null
          discovery_url: string | null
          email_optional: boolean
          enabled: boolean
          id: string
          identifier: string
          issuer: string | null
          jwks_uri: string | null
          name: string
          pkce_enabled: boolean
          provider_type: string
          scopes: string[]
          skip_nonce_check: boolean
          token_url: string | null
          updated_at: string
          userinfo_url: string | null
        }
        Insert: {
          acceptable_client_ids?: string[]
          attribute_mapping?: Json
          authorization_params?: Json
          authorization_url?: string | null
          cached_discovery?: Json | null
          client_id: string
          client_secret: string
          created_at?: string
          discovery_cached_at?: string | null
          discovery_url?: string | null
          email_optional?: boolean
          enabled?: boolean
          id?: string
          identifier: string
          issuer?: string | null
          jwks_uri?: string | null
          name: string
          pkce_enabled?: boolean
          provider_type: string
          scopes?: string[]
          skip_nonce_check?: boolean
          token_url?: string | null
          updated_at?: string
          userinfo_url?: string | null
        }
        Update: {
          acceptable_client_ids?: string[]
          attribute_mapping?: Json
          authorization_params?: Json
          authorization_url?: string | null
          cached_discovery?: Json | null
          client_id?: string
          client_secret?: string
          created_at?: string
          discovery_cached_at?: string | null
          discovery_url?: string | null
          email_optional?: boolean
          enabled?: boolean
          id?: string
          identifier?: string
          issuer?: string | null
          jwks_uri?: string | null
          name?: string
          pkce_enabled?: boolean
          provider_type?: string
          scopes?: string[]
          skip_nonce_check?: boolean
          token_url?: string | null
          updated_at?: string
          userinfo_url?: string | null
        }
        Relationships: []
      }
      flow_state: {
        Row: {
          auth_code: string | null
          auth_code_issued_at: string | null
          authentication_method: string
          code_challenge: string | null
          code_challenge_method:
            | Database["auth"]["Enums"]["code_challenge_method"]
            | null
          created_at: string | null
          email_optional: boolean
          id: string
          invite_token: string | null
          linking_target_id: string | null
          oauth_client_state_id: string | null
          provider_access_token: string | null
          provider_refresh_token: string | null
          provider_type: string
          referrer: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          auth_code?: string | null
          auth_code_issued_at?: string | null
          authentication_method: string
          code_challenge?: string | null
          code_challenge_method?:
            | Database["auth"]["Enums"]["code_challenge_method"]
            | null
          created_at?: string | null
          email_optional?: boolean
          id: string
          invite_token?: string | null
          linking_target_id?: string | null
          oauth_client_state_id?: string | null
          provider_access_token?: string | null
          provider_refresh_token?: string | null
          provider_type: string
          referrer?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          auth_code?: string | null
          auth_code_issued_at?: string | null
          authentication_method?: string
          code_challenge?: string | null
          code_challenge_method?:
            | Database["auth"]["Enums"]["code_challenge_method"]
            | null
          created_at?: string | null
          email_optional?: boolean
          id?: string
          invite_token?: string | null
          linking_target_id?: string | null
          oauth_client_state_id?: string | null
          provider_access_token?: string | null
          provider_refresh_token?: string | null
          provider_type?: string
          referrer?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      identities: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          identity_data: Json
          last_sign_in_at: string | null
          provider: string
          provider_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          identity_data: Json
          last_sign_in_at?: string | null
          provider: string
          provider_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          identity_data?: Json
          last_sign_in_at?: string | null
          provider?: string
          provider_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identities_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      instances: {
        Row: {
          created_at: string | null
          id: string
          raw_base_config: string | null
          updated_at: string | null
          uuid: string | null
        }
        Insert: {
          created_at?: string | null
          id: string
          raw_base_config?: string | null
          updated_at?: string | null
          uuid?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          raw_base_config?: string | null
          updated_at?: string | null
          uuid?: string | null
        }
        Relationships: []
      }
      mfa_amr_claims: {
        Row: {
          authentication_method: string
          created_at: string
          id: string
          session_id: string
          updated_at: string
        }
        Insert: {
          authentication_method: string
          created_at: string
          id: string
          session_id: string
          updated_at: string
        }
        Update: {
          authentication_method?: string
          created_at?: string
          id?: string
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mfa_amr_claims_session_id_fkey"
            columns: ["session_id"]
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_challenges: {
        Row: {
          created_at: string
          factor_id: string
          id: string
          ip_address: unknown
          otp_code: string | null
          verified_at: string | null
          web_authn_session_data: Json | null
        }
        Insert: {
          created_at: string
          factor_id: string
          id: string
          ip_address: unknown
          otp_code?: string | null
          verified_at?: string | null
          web_authn_session_data?: Json | null
        }
        Update: {
          created_at?: string
          factor_id?: string
          id?: string
          ip_address?: unknown
          otp_code?: string | null
          verified_at?: string | null
          web_authn_session_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "mfa_challenges_auth_factor_id_fkey"
            columns: ["factor_id"]
            referencedRelation: "mfa_factors"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_factors: {
        Row: {
          created_at: string
          factor_type: Database["auth"]["Enums"]["factor_type"]
          friendly_name: string | null
          id: string
          last_challenged_at: string | null
          last_webauthn_challenge_data: Json | null
          phone: string | null
          secret: string | null
          status: Database["auth"]["Enums"]["factor_status"]
          updated_at: string
          user_id: string
          web_authn_aaguid: string | null
          web_authn_credential: Json | null
        }
        Insert: {
          created_at: string
          factor_type: Database["auth"]["Enums"]["factor_type"]
          friendly_name?: string | null
          id: string
          last_challenged_at?: string | null
          last_webauthn_challenge_data?: Json | null
          phone?: string | null
          secret?: string | null
          status: Database["auth"]["Enums"]["factor_status"]
          updated_at: string
          user_id: string
          web_authn_aaguid?: string | null
          web_authn_credential?: Json | null
        }
        Update: {
          created_at?: string
          factor_type?: Database["auth"]["Enums"]["factor_type"]
          friendly_name?: string | null
          id?: string
          last_challenged_at?: string | null
          last_webauthn_challenge_data?: Json | null
          phone?: string | null
          secret?: string | null
          status?: Database["auth"]["Enums"]["factor_status"]
          updated_at?: string
          user_id?: string
          web_authn_aaguid?: string | null
          web_authn_credential?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "mfa_factors_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_authorizations: {
        Row: {
          approved_at: string | null
          authorization_code: string | null
          authorization_id: string
          client_id: string
          code_challenge: string | null
          code_challenge_method:
            | Database["auth"]["Enums"]["code_challenge_method"]
            | null
          created_at: string
          expires_at: string
          id: string
          nonce: string | null
          redirect_uri: string
          resource: string | null
          response_type: Database["auth"]["Enums"]["oauth_response_type"]
          scope: string
          state: string | null
          status: Database["auth"]["Enums"]["oauth_authorization_status"]
          user_id: string | null
        }
        Insert: {
          approved_at?: string | null
          authorization_code?: string | null
          authorization_id: string
          client_id: string
          code_challenge?: string | null
          code_challenge_method?:
            | Database["auth"]["Enums"]["code_challenge_method"]
            | null
          created_at?: string
          expires_at?: string
          id: string
          nonce?: string | null
          redirect_uri: string
          resource?: string | null
          response_type?: Database["auth"]["Enums"]["oauth_response_type"]
          scope: string
          state?: string | null
          status?: Database["auth"]["Enums"]["oauth_authorization_status"]
          user_id?: string | null
        }
        Update: {
          approved_at?: string | null
          authorization_code?: string | null
          authorization_id?: string
          client_id?: string
          code_challenge?: string | null
          code_challenge_method?:
            | Database["auth"]["Enums"]["code_challenge_method"]
            | null
          created_at?: string
          expires_at?: string
          id?: string
          nonce?: string | null
          redirect_uri?: string
          resource?: string | null
          response_type?: Database["auth"]["Enums"]["oauth_response_type"]
          scope?: string
          state?: string | null
          status?: Database["auth"]["Enums"]["oauth_authorization_status"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_authorizations_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "oauth_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_authorizations_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_client_states: {
        Row: {
          code_verifier: string | null
          created_at: string
          id: string
          provider_type: string
        }
        Insert: {
          code_verifier?: string | null
          created_at: string
          id: string
          provider_type: string
        }
        Update: {
          code_verifier?: string | null
          created_at?: string
          id?: string
          provider_type?: string
        }
        Relationships: []
      }
      oauth_clients: {
        Row: {
          client_name: string | null
          client_secret_hash: string | null
          client_type: Database["auth"]["Enums"]["oauth_client_type"]
          client_uri: string | null
          created_at: string
          deleted_at: string | null
          grant_types: string
          id: string
          logo_uri: string | null
          redirect_uris: string
          registration_type: Database["auth"]["Enums"]["oauth_registration_type"]
          token_endpoint_auth_method: string
          updated_at: string
        }
        Insert: {
          client_name?: string | null
          client_secret_hash?: string | null
          client_type?: Database["auth"]["Enums"]["oauth_client_type"]
          client_uri?: string | null
          created_at?: string
          deleted_at?: string | null
          grant_types: string
          id: string
          logo_uri?: string | null
          redirect_uris: string
          registration_type: Database["auth"]["Enums"]["oauth_registration_type"]
          token_endpoint_auth_method: string
          updated_at?: string
        }
        Update: {
          client_name?: string | null
          client_secret_hash?: string | null
          client_type?: Database["auth"]["Enums"]["oauth_client_type"]
          client_uri?: string | null
          created_at?: string
          deleted_at?: string | null
          grant_types?: string
          id?: string
          logo_uri?: string | null
          redirect_uris?: string
          registration_type?: Database["auth"]["Enums"]["oauth_registration_type"]
          token_endpoint_auth_method?: string
          updated_at?: string
        }
        Relationships: []
      }
      oauth_consents: {
        Row: {
          client_id: string
          granted_at: string
          id: string
          revoked_at: string | null
          scopes: string
          user_id: string
        }
        Insert: {
          client_id: string
          granted_at?: string
          id: string
          revoked_at?: string | null
          scopes: string
          user_id: string
        }
        Update: {
          client_id?: string
          granted_at?: string
          id?: string
          revoked_at?: string | null
          scopes?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_consents_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "oauth_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_consents_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      one_time_tokens: {
        Row: {
          created_at: string
          id: string
          relates_to: string
          token_hash: string
          token_type: Database["auth"]["Enums"]["one_time_token_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id: string
          relates_to: string
          token_hash: string
          token_type: Database["auth"]["Enums"]["one_time_token_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          relates_to?: string
          token_hash?: string
          token_type?: Database["auth"]["Enums"]["one_time_token_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "one_time_tokens_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      refresh_tokens: {
        Row: {
          created_at: string | null
          id: number
          instance_id: string | null
          parent: string | null
          revoked: boolean | null
          session_id: string | null
          token: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          instance_id?: string | null
          parent?: string | null
          revoked?: boolean | null
          session_id?: string | null
          token?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          instance_id?: string | null
          parent?: string | null
          revoked?: boolean | null
          session_id?: string | null
          token?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refresh_tokens_session_id_fkey"
            columns: ["session_id"]
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      saml_providers: {
        Row: {
          attribute_mapping: Json | null
          created_at: string | null
          entity_id: string
          id: string
          metadata_url: string | null
          metadata_xml: string
          name_id_format: string | null
          sso_provider_id: string
          updated_at: string | null
        }
        Insert: {
          attribute_mapping?: Json | null
          created_at?: string | null
          entity_id: string
          id: string
          metadata_url?: string | null
          metadata_xml: string
          name_id_format?: string | null
          sso_provider_id: string
          updated_at?: string | null
        }
        Update: {
          attribute_mapping?: Json | null
          created_at?: string | null
          entity_id?: string
          id?: string
          metadata_url?: string | null
          metadata_xml?: string
          name_id_format?: string | null
          sso_provider_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saml_providers_sso_provider_id_fkey"
            columns: ["sso_provider_id"]
            referencedRelation: "sso_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      saml_relay_states: {
        Row: {
          created_at: string | null
          flow_state_id: string | null
          for_email: string | null
          id: string
          redirect_to: string | null
          request_id: string
          sso_provider_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          flow_state_id?: string | null
          for_email?: string | null
          id: string
          redirect_to?: string | null
          request_id: string
          sso_provider_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          flow_state_id?: string | null
          for_email?: string | null
          id?: string
          redirect_to?: string | null
          request_id?: string
          sso_provider_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saml_relay_states_flow_state_id_fkey"
            columns: ["flow_state_id"]
            referencedRelation: "flow_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saml_relay_states_sso_provider_id_fkey"
            columns: ["sso_provider_id"]
            referencedRelation: "sso_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      schema_migrations: {
        Row: {
          version: string
        }
        Insert: {
          version: string
        }
        Update: {
          version?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          aal: Database["auth"]["Enums"]["aal_level"] | null
          created_at: string | null
          factor_id: string | null
          id: string
          ip: unknown | null
          not_after: string | null
          oauth_client_id: string | null
          refresh_token_counter: number | null
          refresh_token_hmac_key: string | null
          refreshed_at: string | null
          scopes: string | null
          tag: string | null
          updated_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          aal?: Database["auth"]["Enums"]["aal_level"] | null
          created_at?: string | null
          factor_id?: string | null
          id: string
          ip?: unknown | null
          not_after?: string | null
          oauth_client_id?: string | null
          refresh_token_counter?: number | null
          refresh_token_hmac_key?: string | null
          refreshed_at?: string | null
          scopes?: string | null
          tag?: string | null
          updated_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          aal?: Database["auth"]["Enums"]["aal_level"] | null
          created_at?: string | null
          factor_id?: string | null
          id?: string
          ip?: unknown | null
          not_after?: string | null
          oauth_client_id?: string | null
          refresh_token_counter?: number | null
          refresh_token_hmac_key?: string | null
          refreshed_at?: string | null
          scopes?: string | null
          tag?: string | null
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_oauth_client_id_fkey"
            columns: ["oauth_client_id"]
            referencedRelation: "oauth_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sso_domains: {
        Row: {
          created_at: string | null
          domain: string
          id: string
          sso_provider_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          domain: string
          id: string
          sso_provider_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          domain?: string
          id?: string
          sso_provider_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sso_domains_sso_provider_id_fkey"
            columns: ["sso_provider_id"]
            referencedRelation: "sso_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      sso_providers: {
        Row: {
          created_at: string | null
          disabled: boolean | null
          id: string
          resource_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          disabled?: boolean | null
          id: string
          resource_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          disabled?: boolean | null
          id?: string
          resource_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          aud: string | null
          banned_until: string | null
          confirmation_sent_at: string | null
          confirmation_token: string | null
          confirmed_at: string | null
          created_at: string | null
          deleted_at: string | null
          email: string | null
          email_change: string | null
          email_change_confirm_status: number | null
          email_change_sent_at: string | null
          email_change_token_current: string | null
          email_change_token_new: string | null
          email_confirmed_at: string | null
          encrypted_password: string | null
          id: string
          instance_id: string | null
          invited_at: string | null
          is_anonymous: boolean
          is_sso_user: boolean
          is_super_admin: boolean | null
          last_sign_in_at: string | null
          phone: string | null
          phone_change: string | null
          phone_change_sent_at: string | null
          phone_change_token: string | null
          phone_confirmed_at: string | null
          raw_app_meta_data: Json | null
          raw_user_meta_data: Json | null
          reauthentication_sent_at: string | null
          reauthentication_token: string | null
          recovery_sent_at: string | null
          recovery_token: string | null
          role: string | null
          updated_at: string | null
        }
        Insert: {
          aud?: string | null
          banned_until?: string | null
          confirmation_sent_at?: string | null
          confirmation_token?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          email_change?: string | null
          email_change_confirm_status?: number | null
          email_change_sent_at?: string | null
          email_change_token_current?: string | null
          email_change_token_new?: string | null
          email_confirmed_at?: string | null
          encrypted_password?: string | null
          id: string
          instance_id?: string | null
          invited_at?: string | null
          is_anonymous?: boolean
          is_sso_user?: boolean
          is_super_admin?: boolean | null
          last_sign_in_at?: string | null
          phone?: string | null
          phone_change?: string | null
          phone_change_sent_at?: string | null
          phone_change_token?: string | null
          phone_confirmed_at?: string | null
          raw_app_meta_data?: Json | null
          raw_user_meta_data?: Json | null
          reauthentication_sent_at?: string | null
          reauthentication_token?: string | null
          recovery_sent_at?: string | null
          recovery_token?: string | null
          role?: string | null
          updated_at?: string | null
        }
        Update: {
          aud?: string | null
          banned_until?: string | null
          confirmation_sent_at?: string | null
          confirmation_token?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          email_change?: string | null
          email_change_confirm_status?: number | null
          email_change_sent_at?: string | null
          email_change_token_current?: string | null
          email_change_token_new?: string | null
          email_confirmed_at?: string | null
          encrypted_password?: string | null
          id?: string
          instance_id?: string | null
          invited_at?: string | null
          is_anonymous?: boolean
          is_sso_user?: boolean
          is_super_admin?: boolean | null
          last_sign_in_at?: string | null
          phone?: string | null
          phone_change?: string | null
          phone_change_sent_at?: string | null
          phone_change_token?: string | null
          phone_confirmed_at?: string | null
          raw_app_meta_data?: Json | null
          raw_user_meta_data?: Json | null
          reauthentication_sent_at?: string | null
          reauthentication_token?: string | null
          recovery_sent_at?: string | null
          recovery_token?: string | null
          role?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      webauthn_challenges: {
        Row: {
          challenge_type: string
          created_at: string
          expires_at: string
          id: string
          session_data: Json
          user_id: string | null
        }
        Insert: {
          challenge_type: string
          created_at?: string
          expires_at: string
          id?: string
          session_data: Json
          user_id?: string | null
        }
        Update: {
          challenge_type?: string
          created_at?: string
          expires_at?: string
          id?: string
          session_data?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webauthn_challenges_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      webauthn_credentials: {
        Row: {
          aaguid: string | null
          attestation_type: string
          backed_up: boolean
          backup_eligible: boolean
          created_at: string
          credential_id: string
          friendly_name: string
          id: string
          last_used_at: string | null
          public_key: string
          sign_count: number
          transports: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          aaguid?: string | null
          attestation_type?: string
          backed_up?: boolean
          backup_eligible?: boolean
          created_at?: string
          credential_id: string
          friendly_name?: string
          id?: string
          last_used_at?: string | null
          public_key: string
          sign_count?: number
          transports?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          aaguid?: string | null
          attestation_type?: string
          backed_up?: boolean
          backup_eligible?: boolean
          created_at?: string
          credential_id?: string
          friendly_name?: string
          id?: string
          last_used_at?: string | null
          public_key?: string
          sign_count?: number
          transports?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webauthn_credentials_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      email: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      jwt: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      role: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      uid: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
    }
    Enums: {
      aal_level: "aal1" | "aal2" | "aal3"
      code_challenge_method: "s256" | "plain"
      factor_status: "unverified" | "verified"
      factor_type: "totp" | "webauthn" | "phone"
      oauth_authorization_status: "pending" | "approved" | "denied" | "expired"
      oauth_client_type: "public" | "confidential"
      oauth_registration_type: "dynamic" | "manual"
      oauth_response_type: "code"
      one_time_token_type:
        | "confirmation_token"
        | "reauthentication_token"
        | "recovery_token"
        | "email_change_token_new"
        | "email_change_token_current"
        | "phone_change_token"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  cron: {
    Tables: {
      job: {
        Row: {
          active: boolean
          command: string
          database: string
          jobid: number
          jobname: string | null
          nodename: string
          nodeport: number
          schedule: string
          username: string
        }
        Insert: {
          active?: boolean
          command: string
          database?: string
          jobid?: number
          jobname?: string | null
          nodename?: string
          nodeport?: number
          schedule: string
          username?: string
        }
        Update: {
          active?: boolean
          command?: string
          database?: string
          jobid?: number
          jobname?: string | null
          nodename?: string
          nodeport?: number
          schedule?: string
          username?: string
        }
        Relationships: []
      }
      job_run_details: {
        Row: {
          command: string | null
          database: string | null
          end_time: string | null
          job_pid: number | null
          jobid: number | null
          return_message: string | null
          runid: number
          start_time: string | null
          status: string | null
          username: string | null
        }
        Insert: {
          command?: string | null
          database?: string | null
          end_time?: string | null
          job_pid?: number | null
          jobid?: number | null
          return_message?: string | null
          runid?: number
          start_time?: string | null
          status?: string | null
          username?: string | null
        }
        Update: {
          command?: string | null
          database?: string | null
          end_time?: string | null
          job_pid?: number | null
          jobid?: number | null
          return_message?: string | null
          runid?: number
          start_time?: string | null
          status?: string | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      alter_job: {
        Args: {
          active?: boolean
          command?: string
          database?: string
          job_id: number
          schedule?: string
          username?: string
        }
        Returns: undefined
      }
      schedule: {
        Args:
          | { command: string; job_name: string; schedule: string }
          | { command: string; schedule: string }
        Returns: number
      }
      schedule_in_database: {
        Args: {
          active?: boolean
          command: string
          database: string
          job_name: string
          schedule: string
          username?: string
        }
        Returns: number
      }
      unschedule: {
        Args: { job_id: number } | { job_name: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  extensions: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      pg_stat_statements: {
        Row: {
          blk_read_time: number | null
          blk_write_time: number | null
          calls: number | null
          dbid: unknown | null
          jit_emission_count: number | null
          jit_emission_time: number | null
          jit_functions: number | null
          jit_generation_time: number | null
          jit_inlining_count: number | null
          jit_inlining_time: number | null
          jit_optimization_count: number | null
          jit_optimization_time: number | null
          local_blks_dirtied: number | null
          local_blks_hit: number | null
          local_blks_read: number | null
          local_blks_written: number | null
          max_exec_time: number | null
          max_plan_time: number | null
          mean_exec_time: number | null
          mean_plan_time: number | null
          min_exec_time: number | null
          min_plan_time: number | null
          plans: number | null
          query: string | null
          queryid: number | null
          rows: number | null
          shared_blks_dirtied: number | null
          shared_blks_hit: number | null
          shared_blks_read: number | null
          shared_blks_written: number | null
          stddev_exec_time: number | null
          stddev_plan_time: number | null
          temp_blk_read_time: number | null
          temp_blk_write_time: number | null
          temp_blks_read: number | null
          temp_blks_written: number | null
          toplevel: boolean | null
          total_exec_time: number | null
          total_plan_time: number | null
          userid: unknown | null
          wal_bytes: number | null
          wal_fpi: number | null
          wal_records: number | null
        }
        Relationships: []
      }
      pg_stat_statements_info: {
        Row: {
          dealloc: number | null
          stats_reset: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      algorithm_sign: {
        Args: { algorithm: string; secret: string; signables: string }
        Returns: string
      }
      armor: {
        Args: { "": string }
        Returns: string
      }
      binary_quantize: {
        Args: { "": string } | { "": unknown }
        Returns: unknown
      }
      dearmor: {
        Args: { "": string }
        Returns: string
      }
      gen_random_bytes: {
        Args: { "": number }
        Returns: string
      }
      gen_random_uuid: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      gen_salt: {
        Args: { "": string }
        Returns: string
      }
      halfvec_avg: {
        Args: { "": number[] }
        Returns: unknown
      }
      halfvec_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      halfvec_send: {
        Args: { "": unknown }
        Returns: string
      }
      halfvec_typmod_in: {
        Args: { "": unknown[] }
        Returns: number
      }
      hnsw_bit_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      hnsw_halfvec_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      hnsw_sparsevec_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      hnswhandler: {
        Args: { "": unknown }
        Returns: unknown
      }
      ivfflat_bit_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      ivfflat_halfvec_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      ivfflathandler: {
        Args: { "": unknown }
        Returns: unknown
      }
      l2_norm: {
        Args: { "": unknown } | { "": unknown }
        Returns: number
      }
      l2_normalize: {
        Args: { "": string } | { "": unknown } | { "": unknown }
        Returns: unknown
      }
      pg_stat_statements: {
        Args: { showtext: boolean }
        Returns: Record<string, unknown>[]
      }
      pg_stat_statements_info: {
        Args: Record<PropertyKey, never>
        Returns: Record<string, unknown>
      }
      pg_stat_statements_reset: {
        Args: { dbid?: unknown; queryid?: number; userid?: unknown }
        Returns: undefined
      }
      pgp_armor_headers: {
        Args: { "": string }
        Returns: Record<string, unknown>[]
      }
      pgp_key_id: {
        Args: { "": string }
        Returns: string
      }
      sign: {
        Args: { algorithm?: string; payload: Json; secret: string }
        Returns: string
      }
      sparsevec_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      sparsevec_send: {
        Args: { "": unknown }
        Returns: string
      }
      sparsevec_typmod_in: {
        Args: { "": unknown[] }
        Returns: number
      }
      try_cast_double: {
        Args: { inp: string }
        Returns: number
      }
      url_decode: {
        Args: { data: string }
        Returns: string
      }
      url_encode: {
        Args: { data: string }
        Returns: string
      }
      uuid_generate_v1: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      uuid_generate_v1mc: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      uuid_generate_v3: {
        Args: { name: string; namespace: string }
        Returns: string
      }
      uuid_generate_v4: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      uuid_generate_v5: {
        Args: { name: string; namespace: string }
        Returns: string
      }
      uuid_nil: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      uuid_ns_dns: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      uuid_ns_oid: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      uuid_ns_url: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      uuid_ns_x500: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      vector_avg: {
        Args: { "": number[] }
        Returns: string
      }
      vector_dims: {
        Args: { "": string } | { "": unknown }
        Returns: number
      }
      vector_norm: {
        Args: { "": string }
        Returns: number
      }
      vector_out: {
        Args: { "": string }
        Returns: unknown
      }
      vector_send: {
        Args: { "": string }
        Returns: string
      }
      vector_typmod_in: {
        Args: { "": unknown[] }
        Returns: number
      }
      verify: {
        Args: { algorithm?: string; secret: string; token: string }
        Returns: {
          header: Json
          payload: Json
          valid: boolean
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  graphql: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _internal_resolve: {
        Args: {
          extensions?: Json
          operationName?: string
          query: string
          variables?: Json
        }
        Returns: Json
      }
      comment_directive: {
        Args: { comment_: string }
        Returns: Json
      }
      exception: {
        Args: { message: string }
        Returns: string
      }
      get_schema_version: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      resolve: {
        Args: {
          extensions?: Json
          operationName?: string
          query: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  net: {
    Tables: {
      _http_response: {
        Row: {
          content: string | null
          content_type: string | null
          created: string
          error_msg: string | null
          headers: Json | null
          id: number | null
          status_code: number | null
          timed_out: boolean | null
        }
        Insert: {
          content?: string | null
          content_type?: string | null
          created?: string
          error_msg?: string | null
          headers?: Json | null
          id?: number | null
          status_code?: number | null
          timed_out?: boolean | null
        }
        Update: {
          content?: string | null
          content_type?: string | null
          created?: string
          error_msg?: string | null
          headers?: Json | null
          id?: number | null
          status_code?: number | null
          timed_out?: boolean | null
        }
        Relationships: []
      }
      http_request_queue: {
        Row: {
          body: string | null
          headers: Json
          id: number
          method: string
          timeout_milliseconds: number
          url: string
        }
        Insert: {
          body?: string | null
          headers: Json
          id?: number
          method: string
          timeout_milliseconds: number
          url: string
        }
        Update: {
          body?: string | null
          headers?: Json
          id?: number
          method?: string
          timeout_milliseconds?: number
          url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _await_response: {
        Args: { request_id: number }
        Returns: boolean
      }
      _encode_url_with_params_array: {
        Args: { params_array: string[]; url: string }
        Returns: string
      }
      _http_collect_response: {
        Args: { async?: boolean; request_id: number }
        Returns: Database["net"]["CompositeTypes"]["http_response_result"]
      }
      _urlencode_string: {
        Args: { string: string }
        Returns: string
      }
      check_worker_is_up: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      http_collect_response: {
        Args: { async?: boolean; request_id: number }
        Returns: Database["net"]["CompositeTypes"]["http_response_result"]
      }
      http_delete: {
        Args: {
          headers?: Json
          params?: Json
          timeout_milliseconds?: number
          url: string
        }
        Returns: number
      }
      http_get: {
        Args: {
          headers?: Json
          params?: Json
          timeout_milliseconds?: number
          url: string
        }
        Returns: number
      }
      http_post: {
        Args: {
          body?: Json
          headers?: Json
          params?: Json
          timeout_milliseconds?: number
          url: string
        }
        Returns: number
      }
      worker_restart: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
    }
    Enums: {
      request_status: "PENDING" | "SUCCESS" | "ERROR"
    }
    CompositeTypes: {
      http_response: {
        status_code: number | null
        headers: Json | null
        body: string | null
      }
      http_response_result: {
        status: Database["net"]["Enums"]["request_status"] | null
        message: string | null
        response: Database["net"]["CompositeTypes"]["http_response"] | null
      }
    }
  }
  pgbouncer: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_auth: {
        Args: { p_usename: string }
        Returns: {
          password: string
          username: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      action_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by_request_id: string | null
          depends_on: Json
          due_at: string | null
          id: string
          instructions: string | null
          last_error: string | null
          org_id: string
          outcome: Json
          outcome_measure: Json
          owner_role: string | null
          owner_twin_id: string
          recommendation_id: string | null
          required_evidence: Json
          resource_link: string | null
          retry_count: number
          started_at: string | null
          status: string
          task_code: string | null
          title: string
          updated_at: string
          verification: Json
          version: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by_request_id?: string | null
          depends_on?: Json
          due_at?: string | null
          id?: string
          instructions?: string | null
          last_error?: string | null
          org_id: string
          outcome?: Json
          outcome_measure?: Json
          owner_role?: string | null
          owner_twin_id: string
          recommendation_id?: string | null
          required_evidence?: Json
          resource_link?: string | null
          retry_count?: number
          started_at?: string | null
          status?: string
          task_code?: string | null
          title: string
          updated_at?: string
          verification?: Json
          version?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by_request_id?: string | null
          depends_on?: Json
          due_at?: string | null
          id?: string
          instructions?: string | null
          last_error?: string | null
          org_id?: string
          outcome?: Json
          outcome_measure?: Json
          owner_role?: string | null
          owner_twin_id?: string
          recommendation_id?: string | null
          required_evidence?: Json
          resource_link?: string | null
          retry_count?: number
          started_at?: string | null
          status?: string
          task_code?: string | null
          title?: string
          updated_at?: string
          verification?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "action_tasks_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_tasks_owner_twin_id_fkey"
            columns: ["owner_twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_tasks_recommendation_id_fkey"
            columns: ["recommendation_id"]
            referencedRelation: "recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_actions: {
        Row: {
          action: string
          actor_twin_id: string
          after_data: Json
          before_data: Json
          created_at: string
          id: string
          org_id: string
          reason: string | null
          target_email: string | null
          target_twin_id: string | null
        }
        Insert: {
          action: string
          actor_twin_id: string
          after_data?: Json
          before_data?: Json
          created_at?: string
          id?: string
          org_id: string
          reason?: string | null
          target_email?: string | null
          target_twin_id?: string | null
        }
        Update: {
          action?: string
          actor_twin_id?: string
          after_data?: Json
          before_data?: Json
          created_at?: string
          id?: string
          org_id?: string
          reason?: string | null
          target_email?: string | null
          target_twin_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_actions_actor_twin_id_fkey"
            columns: ["actor_twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_actions_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_actions_target_twin_id_fkey"
            columns: ["target_twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
      application_stage_events: {
        Row: {
          actor_twin_id: string
          application_id: string
          at: string
          audit_ref: string | null
          id: string
          new_stage: string
          org_id: string
          prior_stage: string
          reason: string | null
          version: number
        }
        Insert: {
          actor_twin_id: string
          application_id: string
          at?: string
          audit_ref?: string | null
          id?: string
          new_stage: string
          org_id: string
          prior_stage: string
          reason?: string | null
          version: number
        }
        Update: {
          actor_twin_id?: string
          application_id?: string
          at?: string
          audit_ref?: string | null
          id?: string
          new_stage?: string
          org_id?: string
          prior_stage?: string
          reason?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "application_stage_events_actor_twin_id_fkey"
            columns: ["actor_twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_stage_events_application_id_fkey"
            columns: ["application_id"]
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_stage_events_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          application_code: string
          applied_at: string
          candidate_twin_id: string
          created_at: string
          id: string
          org_id: string
          requisition_id: string
          stage: string
          updated_at: string
          version: number
        }
        Insert: {
          application_code: string
          applied_at?: string
          candidate_twin_id: string
          created_at?: string
          id?: string
          org_id: string
          requisition_id: string
          stage?: string
          updated_at?: string
          version?: number
        }
        Update: {
          application_code?: string
          applied_at?: string
          candidate_twin_id?: string
          created_at?: string
          id?: string
          org_id?: string
          requisition_id?: string
          stage?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "applications_candidate_twin_id_fkey"
            columns: ["candidate_twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_requisition_id_fkey"
            columns: ["requisition_id"]
            referencedRelation: "job_requisitions"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_blueprints: {
        Row: {
          artifact_spec: Json
          competency: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          org_id: string
          prompt_adaptation_allowed: boolean
          requisition_id: string
          test_cases: Json
          version: number
        }
        Insert: {
          artifact_spec?: Json
          competency: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          org_id: string
          prompt_adaptation_allowed?: boolean
          requisition_id: string
          test_cases?: Json
          version?: number
        }
        Update: {
          artifact_spec?: Json
          competency?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          org_id?: string
          prompt_adaptation_allowed?: boolean
          requisition_id?: string
          test_cases?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "assessment_blueprints_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_blueprints_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_blueprints_requisition_id_fkey"
            columns: ["requisition_id"]
            referencedRelation: "job_requisitions"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_rubrics: {
        Row: {
          anchors: Json
          blueprint_id: string
          competency: string
          created_at: string
          critical_mistakes: Json
          evidence_requirements: Json
          id: string
          insufficient_evidence_conditions: Json
          observable_behavior: string
          org_id: string
          skill_mapping: Json
          version: number
        }
        Insert: {
          anchors?: Json
          blueprint_id: string
          competency: string
          created_at?: string
          critical_mistakes?: Json
          evidence_requirements?: Json
          id?: string
          insufficient_evidence_conditions?: Json
          observable_behavior: string
          org_id: string
          skill_mapping?: Json
          version?: number
        }
        Update: {
          anchors?: Json
          blueprint_id?: string
          competency?: string
          created_at?: string
          critical_mistakes?: Json
          evidence_requirements?: Json
          id?: string
          insufficient_evidence_conditions?: Json
          observable_behavior?: string
          org_id?: string
          skill_mapping?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "assessment_rubrics_blueprint_id_fkey"
            columns: ["blueprint_id"]
            referencedRelation: "assessment_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_rubrics_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      assessments: {
        Row: {
          created_at: string
          id: string
          org_id: string
          requisition_id: string | null
          result: Json
          reviewed_at: string | null
          reviewed_by: string | null
          twin_id: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          requisition_id?: string | null
          result?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          twin_id: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          requisition_id?: string | null
          result?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          twin_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessments_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_requisition_id_fkey"
            columns: ["requisition_id"]
            referencedRelation: "job_requisitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_twin_id_fkey"
            columns: ["twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_sessions: {
        Row: {
          accommodation: Json
          answers: Json
          application_id: string
          blueprint_id: string
          created_at: string
          drafts: Json
          expires_at: string
          follow_ups: Json
          id: string
          invitation_token: string
          org_id: string
          rubric_id: string | null
          session_type: string
          status: string
          submission_hash: string | null
          submitted_at: string | null
          time_policy: string | null
          twin_id: string
          updated_at: string
        }
        Insert: {
          accommodation?: Json
          answers?: Json
          application_id: string
          blueprint_id: string
          created_at?: string
          drafts?: Json
          expires_at: string
          follow_ups?: Json
          id?: string
          invitation_token: string
          org_id: string
          rubric_id?: string | null
          session_type: string
          status?: string
          submission_hash?: string | null
          submitted_at?: string | null
          time_policy?: string | null
          twin_id: string
          updated_at?: string
        }
        Update: {
          accommodation?: Json
          answers?: Json
          application_id?: string
          blueprint_id?: string
          created_at?: string
          drafts?: Json
          expires_at?: string
          follow_ups?: Json
          id?: string
          invitation_token?: string
          org_id?: string
          rubric_id?: string | null
          session_type?: string
          status?: string
          submission_hash?: string | null
          submitted_at?: string | null
          time_policy?: string | null
          twin_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_sessions_application_id_fkey"
            columns: ["application_id"]
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_sessions_blueprint_id_fkey"
            columns: ["blueprint_id"]
            referencedRelation: "assessment_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_sessions_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_sessions_rubric_id_fkey"
            columns: ["rubric_id"]
            referencedRelation: "assessment_rubrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_sessions_twin_id_fkey"
            columns: ["twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
      digital_twins: {
        Row: {
          attendance: Json
          audit_events: Json
          auth_user_id: string | null
          computed_fits: Json
          created_at: string
          delivery: Json
          department: string | null
          email: string
          id: string
          interview_rubrics: Json
          job_title: string | null
          manager_id: string | null
          name: string
          org_id: string | null
          performance_history: Json
          performance_synthesis: Json
          promotion_lag_months: number
          resume_text: string | null
          role: string
          seniority_level: number
          signals: Json
          status: string
          tenure_months: number
          updated_at: string
          verified_skills: Json
          work_location: string | null
          worker_type: string | null
        }
        Insert: {
          attendance?: Json
          audit_events?: Json
          auth_user_id?: string | null
          computed_fits?: Json
          created_at?: string
          delivery?: Json
          department?: string | null
          email: string
          id?: string
          interview_rubrics?: Json
          job_title?: string | null
          manager_id?: string | null
          name: string
          org_id?: string | null
          performance_history?: Json
          performance_synthesis?: Json
          promotion_lag_months?: number
          resume_text?: string | null
          role: string
          seniority_level?: number
          signals?: Json
          status?: string
          tenure_months?: number
          updated_at?: string
          verified_skills?: Json
          work_location?: string | null
          worker_type?: string | null
        }
        Update: {
          attendance?: Json
          audit_events?: Json
          auth_user_id?: string | null
          computed_fits?: Json
          created_at?: string
          delivery?: Json
          department?: string | null
          email?: string
          id?: string
          interview_rubrics?: Json
          job_title?: string | null
          manager_id?: string | null
          name?: string
          org_id?: string | null
          performance_history?: Json
          performance_synthesis?: Json
          promotion_lag_months?: number
          resume_text?: string | null
          role?: string
          seniority_level?: number
          signals?: Json
          status?: string
          tenure_months?: number
          updated_at?: string
          verified_skills?: Json
          work_location?: string | null
          worker_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "digital_twins_manager_id_fkey"
            columns: ["manager_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digital_twins_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_items: {
        Row: {
          captured_at: string
          created_at: string
          id: string
          metadata: Json
          org_id: string
          quote: string | null
          review_state: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_id: string | null
          source_type: string
          source_version: string | null
          span: string | null
          twin_id: string | null
        }
        Insert: {
          captured_at?: string
          created_at?: string
          id?: string
          metadata?: Json
          org_id: string
          quote?: string | null
          review_state?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id?: string | null
          source_type: string
          source_version?: string | null
          span?: string | null
          twin_id?: string | null
        }
        Update: {
          captured_at?: string
          created_at?: string
          id?: string
          metadata?: Json
          org_id?: string
          quote?: string | null
          review_state?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id?: string | null
          source_type?: string
          source_version?: string | null
          span?: string | null
          twin_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_items_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_items_reviewed_by_fkey"
            columns: ["reviewed_by"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_items_twin_id_fkey"
            columns: ["twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
      job_requisitions: {
        Row: {
          applicants: Json
          audit_events: Json
          created_at: string
          department: string
          future_skills: Json
          id: string
          org_id: string
          required_skills: Json
          requisition_criteria: Json
          rubrics: Json
          seniority_level: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          applicants?: Json
          audit_events?: Json
          created_at?: string
          department: string
          future_skills?: Json
          id?: string
          org_id: string
          required_skills?: Json
          requisition_criteria?: Json
          rubrics?: Json
          seniority_level?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          applicants?: Json
          audit_events?: Json
          created_at?: string
          department?: string
          future_skills?: Json
          id?: string
          org_id?: string
          required_skills?: Json
          requisition_criteria?: Json
          rubrics?: Json
          seniority_level?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_requisitions_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_cache: {
        Row: {
          created_at: string
          id: string
          input_hash: string
          model: string
          org_id: string
          output: Json
          task: string
        }
        Insert: {
          created_at?: string
          id?: string
          input_hash: string
          model: string
          org_id: string
          output: Json
          task: string
        }
        Update: {
          created_at?: string
          id?: string
          input_hash?: string
          model?: string
          org_id?: string
          output?: Json
          task?: string
        }
        Relationships: [
          {
            foreignKeyName: "llm_cache_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      model_jobs: {
        Row: {
          actor_id: string
          created_at: string
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          input_hash: string
          latency_ms: number | null
          model: string
          org_id: string
          output: Json | null
          prompt_version: string
          retry_count: number
          schema_version: string
          started_at: string | null
          status: string
          task: string
          tokens_in: number | null
          tokens_out: number | null
        }
        Insert: {
          actor_id: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input_hash: string
          latency_ms?: number | null
          model?: string
          org_id: string
          output?: Json | null
          prompt_version: string
          retry_count?: number
          schema_version: string
          started_at?: string | null
          status?: string
          task: string
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Update: {
          actor_id?: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input_hash?: string
          latency_ms?: number | null
          model?: string
          org_id?: string
          output?: Json | null
          prompt_version?: string
          retry_count?: number
          schema_version?: string
          started_at?: string | null
          status?: string
          task?: string
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "model_jobs_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_journeys: {
        Row: {
          audit_events: Json
          created_at: string
          id: string
          org_id: string
          plan: Json
          status: string
          tasks: Json
          twin_id: string
          updated_at: string
        }
        Insert: {
          audit_events?: Json
          created_at?: string
          id?: string
          org_id: string
          plan?: Json
          status?: string
          tasks?: Json
          twin_id: string
          updated_at?: string
        }
        Update: {
          audit_events?: Json
          created_at?: string
          id?: string
          org_id?: string
          plan?: Json
          status?: string
          tasks?: Json
          twin_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_journeys_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_journeys_twin_id_fkey"
            columns: ["twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_plans: {
        Row: {
          application_id: string | null
          audit_events: Json
          carryover: Json
          created_at: string
          generated_at: string
          hr_approval: Json | null
          id: string
          manager_approval: Json | null
          org_id: string
          plan_hash: string
          readiness: Json
          start_date: string
          status: string
          twin_id: string
          updated_at: string
          version: number
        }
        Insert: {
          application_id?: string | null
          audit_events?: Json
          carryover?: Json
          created_at?: string
          generated_at?: string
          hr_approval?: Json | null
          id?: string
          manager_approval?: Json | null
          org_id: string
          plan_hash: string
          readiness?: Json
          start_date: string
          status?: string
          twin_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          application_id?: string | null
          audit_events?: Json
          carryover?: Json
          created_at?: string
          generated_at?: string
          hr_approval?: Json | null
          id?: string
          manager_approval?: Json | null
          org_id?: string
          plan_hash?: string
          readiness?: Json
          start_date?: string
          status?: string
          twin_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_plans_application_id_fkey"
            columns: ["application_id"]
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_plans_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_plans_twin_id_fkey"
            columns: ["twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_task_events: {
        Row: {
          action: string
          actor_twin_id: string | null
          attempt_hash: string
          created_at: string
          evidence: Json
          id: string
          note: string | null
          org_id: string
          plan_id: string
          result: string
          task_code: string
        }
        Insert: {
          action: string
          actor_twin_id?: string | null
          attempt_hash: string
          created_at?: string
          evidence?: Json
          id?: string
          note?: string | null
          org_id: string
          plan_id: string
          result: string
          task_code: string
        }
        Update: {
          action?: string
          actor_twin_id?: string | null
          attempt_hash?: string
          created_at?: string
          evidence?: Json
          id?: string
          note?: string | null
          org_id?: string
          plan_id?: string
          result?: string
          task_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_task_events_actor_twin_id_fkey"
            columns: ["actor_twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_task_events_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_task_events_plan_id_fkey"
            columns: ["plan_id"]
            referencedRelation: "onboarding_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_tasks: {
        Row: {
          adaptation: Json | null
          blockers: Json
          completion_record: Json | null
          created_at: string
          depends_on: Json
          due_date: string | null
          duration_days: number
          evidence_requirements: Json
          id: string
          non_waivable: boolean
          org_id: string
          owner_role: string
          plan_id: string
          required: boolean
          state: string
          task_code: string
          task_type: string
          title: string
          topological_level: number
          updated_at: string
          version: number
          waiver: Json | null
          why_evidence: Json
        }
        Insert: {
          adaptation?: Json | null
          blockers?: Json
          completion_record?: Json | null
          created_at?: string
          depends_on?: Json
          due_date?: string | null
          duration_days?: number
          evidence_requirements?: Json
          id?: string
          non_waivable?: boolean
          org_id: string
          owner_role: string
          plan_id: string
          required?: boolean
          state?: string
          task_code: string
          task_type: string
          title: string
          topological_level?: number
          updated_at?: string
          version?: number
          waiver?: Json | null
          why_evidence?: Json
        }
        Update: {
          adaptation?: Json | null
          blockers?: Json
          completion_record?: Json | null
          created_at?: string
          depends_on?: Json
          due_date?: string | null
          duration_days?: number
          evidence_requirements?: Json
          id?: string
          non_waivable?: boolean
          org_id?: string
          owner_role?: string
          plan_id?: string
          required?: boolean
          state?: string
          task_code?: string
          task_type?: string
          title?: string
          topological_level?: number
          updated_at?: string
          version?: number
          waiver?: Json | null
          why_evidence?: Json
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_tasks_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_tasks_plan_id_fkey"
            columns: ["plan_id"]
            referencedRelation: "onboarding_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          learning_options: Json
          name: string
          policies: Json
          staffing_projects: Json
        }
        Insert: {
          created_at?: string
          id?: string
          learning_options?: Json
          name: string
          policies?: Json
          staffing_projects?: Json
        }
        Update: {
          created_at?: string
          id?: string
          learning_options?: Json
          name?: string
          policies?: Json
          staffing_projects?: Json
        }
        Relationships: []
      }
      performance_summaries: {
        Row: {
          contradictions: Json
          development_actions: Json
          evidence_summary: Json
          feedback_stats: Json
          from_cache: boolean
          generated_at: string
          goal_stats: Json
          id: string
          improvement_areas: Json
          inferred_themes: Json
          model_note: string
          narrative: string
          org_id: string
          period: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_draft: Json
          reviewer_draft_at: string | null
          reviewer_draft_by: string | null
          source_facts: Json
          source_version_hash: string
          sparse_evidence: Json
          strengths: Json
          twin_id: string
        }
        Insert: {
          contradictions?: Json
          development_actions?: Json
          evidence_summary?: Json
          feedback_stats?: Json
          from_cache?: boolean
          generated_at?: string
          goal_stats?: Json
          id?: string
          improvement_areas?: Json
          inferred_themes?: Json
          model_note?: string
          narrative?: string
          org_id: string
          period: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_draft?: Json
          reviewer_draft_at?: string | null
          reviewer_draft_by?: string | null
          source_facts?: Json
          source_version_hash: string
          sparse_evidence?: Json
          strengths?: Json
          twin_id: string
        }
        Update: {
          contradictions?: Json
          development_actions?: Json
          evidence_summary?: Json
          feedback_stats?: Json
          from_cache?: boolean
          generated_at?: string
          goal_stats?: Json
          id?: string
          improvement_areas?: Json
          inferred_themes?: Json
          model_note?: string
          narrative?: string
          org_id?: string
          period?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_draft?: Json
          reviewer_draft_at?: string | null
          reviewer_draft_by?: string | null
          source_facts?: Json
          source_version_hash?: string
          sparse_evidence?: Json
          strengths?: Json
          twin_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_summaries_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_summaries_reviewed_by_fkey"
            columns: ["reviewed_by"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_summaries_reviewer_draft_by_fkey"
            columns: ["reviewer_draft_by"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_summaries_twin_id_fkey"
            columns: ["twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_documents: {
        Row: {
          applicable_locations: Json
          applicable_worker_types: Json
          category: string | null
          created_at: string
          doc_code: string
          effective_from: string
          effective_to: string | null
          id: string
          org_id: string
          sections: Json
          supersedes_doc_id: string | null
          title: string
          version: number
        }
        Insert: {
          applicable_locations?: Json
          applicable_worker_types?: Json
          category?: string | null
          created_at?: string
          doc_code: string
          effective_from: string
          effective_to?: string | null
          id?: string
          org_id: string
          sections?: Json
          supersedes_doc_id?: string | null
          title: string
          version?: number
        }
        Update: {
          applicable_locations?: Json
          applicable_worker_types?: Json
          category?: string | null
          created_at?: string
          doc_code?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          org_id?: string
          sections?: Json
          supersedes_doc_id?: string | null
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "policy_documents_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_documents_supersedes_doc_id_fkey"
            columns: ["supersedes_doc_id"]
            referencedRelation: "policy_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_escalations: {
        Row: {
          created_at: string
          created_by: string | null
          history: Json
          id: string
          org_id: string
          owner_twin_id: string | null
          question: string
          reason: string | null
          relevant_sources: Json
          resolved_at: string | null
          responded_at: string | null
          responded_by: string | null
          response_text: string | null
          selected_context: Json
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          history?: Json
          id?: string
          org_id: string
          owner_twin_id?: string | null
          question: string
          reason?: string | null
          relevant_sources?: Json
          resolved_at?: string | null
          responded_at?: string | null
          responded_by?: string | null
          response_text?: string | null
          selected_context?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          history?: Json
          id?: string
          org_id?: string
          owner_twin_id?: string | null
          question?: string
          reason?: string | null
          relevant_sources?: Json
          resolved_at?: string | null
          responded_at?: string | null
          responded_by?: string | null
          response_text?: string | null
          selected_context?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_escalations_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_escalations_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_escalations_owner_twin_id_fkey"
            columns: ["owner_twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_escalations_responded_by_fkey"
            columns: ["responded_by"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_comments: {
        Row: {
          actor_role: string | null
          actor_twin_id: string
          body: string
          created_at: string
          id: string
          org_id: string
          recommendation_id: string
          visibility: string
        }
        Insert: {
          actor_role?: string | null
          actor_twin_id: string
          body: string
          created_at?: string
          id?: string
          org_id: string
          recommendation_id: string
          visibility?: string
        }
        Update: {
          actor_role?: string | null
          actor_twin_id?: string
          body?: string
          created_at?: string
          id?: string
          org_id?: string
          recommendation_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_comments_actor_twin_id_fkey"
            columns: ["actor_twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_comments_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_comments_recommendation_id_fkey"
            columns: ["recommendation_id"]
            referencedRelation: "recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendations: {
        Row: {
          alternatives: Json
          approved_at: string | null
          audit_events: Json
          category: string
          created_at: string
          evidence_ledger: Json
          executive_summary: string
          expires_at: string | null
          id: string
          intended_outcome: Json
          last_reviewed_at: string | null
          org_id: string
          outcomes: Json
          proposed_action: Json
          required_approvers: Json
          required_signoff_role: string | null
          resource_ref: string | null
          reviewer_rationale: Json
          source_hash: string | null
          stale: boolean
          stale_reason: string | null
          status: string
          superseded_by: string | null
          twin_id: string | null
          updated_at: string
          urgency: string
          version: number
        }
        Insert: {
          alternatives?: Json
          approved_at?: string | null
          audit_events?: Json
          category: string
          created_at?: string
          evidence_ledger?: Json
          executive_summary?: string
          expires_at?: string | null
          id?: string
          intended_outcome?: Json
          last_reviewed_at?: string | null
          org_id: string
          outcomes?: Json
          proposed_action?: Json
          required_approvers?: Json
          required_signoff_role?: string | null
          resource_ref?: string | null
          reviewer_rationale?: Json
          source_hash?: string | null
          stale?: boolean
          stale_reason?: string | null
          status?: string
          superseded_by?: string | null
          twin_id?: string | null
          updated_at?: string
          urgency?: string
          version?: number
        }
        Update: {
          alternatives?: Json
          approved_at?: string | null
          audit_events?: Json
          category?: string
          created_at?: string
          evidence_ledger?: Json
          executive_summary?: string
          expires_at?: string | null
          id?: string
          intended_outcome?: Json
          last_reviewed_at?: string | null
          org_id?: string
          outcomes?: Json
          proposed_action?: Json
          required_approvers?: Json
          required_signoff_role?: string | null
          resource_ref?: string | null
          reviewer_rationale?: Json
          source_hash?: string | null
          stale?: boolean
          stale_reason?: string | null
          status?: string
          superseded_by?: string | null
          twin_id?: string | null
          updated_at?: string
          urgency?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_superseded_by_fkey"
            columns: ["superseded_by"]
            referencedRelation: "recommendations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_twin_id_fkey"
            columns: ["twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
      resume_documents: {
        Row: {
          checksum: string
          content_type: string
          created_at: string
          error_code: string | null
          error_message: string | null
          extracted_text: string | null
          file_name: string
          id: string
          low_text: boolean
          org_id: string
          page_count: number | null
          size_bytes: number
          status: string
          storage_path: string
          text_pages: Json
          twin_id: string
          updated_at: string
        }
        Insert: {
          checksum: string
          content_type: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          extracted_text?: string | null
          file_name: string
          id?: string
          low_text?: boolean
          org_id: string
          page_count?: number | null
          size_bytes: number
          status?: string
          storage_path: string
          text_pages?: Json
          twin_id: string
          updated_at?: string
        }
        Update: {
          checksum?: string
          content_type?: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          extracted_text?: string | null
          file_name?: string
          id?: string
          low_text?: boolean
          org_id?: string
          page_count?: number | null
          size_bytes?: number
          status?: string
          storage_path?: string
          text_pages?: Json
          twin_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resume_documents_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_documents_twin_id_fkey"
            columns: ["twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
      resume_versions: {
        Row: {
          created_at: string
          document_id: string
          id: string
          org_id: string
          payload: Json
          review_state: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_hash: string
          twin_id: string
          version: number
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          org_id: string
          payload?: Json
          review_state?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_hash: string
          twin_id: string
          version?: number
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          org_id?: string
          payload?: Json
          review_state?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_hash?: string
          twin_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "resume_versions_document_id_fkey"
            columns: ["document_id"]
            referencedRelation: "resume_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_versions_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_versions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_versions_twin_id_fkey"
            columns: ["twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
      review_case_actions: {
        Row: {
          acted_at: string
          acted_by: string
          action: string
          case_id: string | null
          created_at: string
          follow_up_at: string | null
          id: string
          org_id: string
          reason: string
          twin_id: string
        }
        Insert: {
          acted_at?: string
          acted_by: string
          action: string
          case_id?: string | null
          created_at?: string
          follow_up_at?: string | null
          id?: string
          org_id: string
          reason: string
          twin_id: string
        }
        Update: {
          acted_at?: string
          acted_by?: string
          action?: string
          case_id?: string | null
          created_at?: string
          follow_up_at?: string | null
          id?: string
          org_id?: string
          reason?: string
          twin_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_case_actions_acted_by_fkey"
            columns: ["acted_by"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_case_actions_case_id_fkey"
            columns: ["case_id"]
            referencedRelation: "workforce_review_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_case_actions_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_case_actions_twin_id_fkey"
            columns: ["twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_assertions: {
        Row: {
          claimed_proficiency: number
          created_at: string
          evidence_ids: Json
          id: string
          org_id: string
          proficiency_tier: string | null
          review_state: string
          skill_id: string
          twin_id: string
        }
        Insert: {
          claimed_proficiency: number
          created_at?: string
          evidence_ids?: Json
          id?: string
          org_id: string
          proficiency_tier?: string | null
          review_state?: string
          skill_id: string
          twin_id: string
        }
        Update: {
          claimed_proficiency?: number
          created_at?: string
          evidence_ids?: Json
          id?: string
          org_id?: string
          proficiency_tier?: string | null
          review_state?: string
          skill_id?: string
          twin_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_assertions_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_assertions_skill_id_fkey"
            columns: ["skill_id"]
            referencedRelation: "skill_graph"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_assertions_twin_id_fkey"
            columns: ["twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_fits: {
        Row: {
          computed_at: string
          created_at: string
          fit: Json
          id: string
          org_id: string
          scenario: string
          target_id: string
          target_type: string
          twin_id: string
        }
        Insert: {
          computed_at?: string
          created_at?: string
          fit?: Json
          id?: string
          org_id: string
          scenario: string
          target_id: string
          target_type: string
          twin_id: string
        }
        Update: {
          computed_at?: string
          created_at?: string
          fit?: Json
          id?: string
          org_id?: string
          scenario?: string
          target_id?: string
          target_type?: string
          twin_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_fits_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_fits_target_id_fkey"
            columns: ["target_id"]
            referencedRelation: "job_requisitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_fits_twin_id_fkey"
            columns: ["twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_graph: {
        Row: {
          aliases: Json
          category: string | null
          created_at: string
          id: string
          org_id: string
          outgoing_edges: Json
          skill: string
        }
        Insert: {
          aliases?: Json
          category?: string | null
          created_at?: string
          id?: string
          org_id: string
          outgoing_edges?: Json
          skill: string
        }
        Update: {
          aliases?: Json
          category?: string | null
          created_at?: string
          id?: string
          org_id?: string
          outgoing_edges?: Json
          skill?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_graph_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staffing_proposals: {
        Row: {
          created_at: string
          id: string
          org_id: string
          review_note: string | null
          scenario_id: string | null
          status: string
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          review_note?: string | null
          scenario_id?: string | null
          status?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          review_note?: string | null
          scenario_id?: string | null
          status?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staffing_proposals_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staffing_proposals_scenario_id_fkey"
            columns: ["scenario_id"]
            referencedRelation: "staffing_scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staffing_proposals_submitted_by_fkey"
            columns: ["submitted_by"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
      staffing_scenarios: {
        Row: {
          assumptions: Json
          created_at: string
          created_by: string | null
          id: string
          input_snapshot: Json
          name: string
          org_id: string
          result: Json
        }
        Insert: {
          assumptions?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          input_snapshot?: Json
          name: string
          org_id: string
          result?: Json
        }
        Update: {
          assumptions?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          input_snapshot?: Json
          name?: string
          org_id?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "staffing_scenarios_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staffing_scenarios_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_events: {
        Row: {
          actor_role: string | null
          actor_twin_id: string | null
          created_at: string
          id: string
          new_status: string | null
          org_id: string
          payload: Json
          prior_status: string | null
          reason: string | null
          request_id: string
          resource: string | null
          resource_id: string
          resource_type: string
          source_version: string | null
        }
        Insert: {
          actor_role?: string | null
          actor_twin_id?: string | null
          created_at?: string
          id?: string
          new_status?: string | null
          org_id: string
          payload?: Json
          prior_status?: string | null
          reason?: string | null
          request_id: string
          resource?: string | null
          resource_id: string
          resource_type: string
          source_version?: string | null
        }
        Update: {
          actor_role?: string | null
          actor_twin_id?: string | null
          created_at?: string
          id?: string
          new_status?: string | null
          org_id?: string
          payload?: Json
          prior_status?: string | null
          reason?: string | null
          request_id?: string
          resource?: string | null
          resource_id?: string
          resource_type?: string
          source_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_events_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      workforce_observations: {
        Row: {
          created_at: string
          id: string
          metric: string
          missing: boolean
          org_id: string
          period_end: string
          period_start: string
          twin_id: string
          value: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          metric: string
          missing?: boolean
          org_id: string
          period_end: string
          period_start: string
          twin_id: string
          value?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          metric?: string
          missing?: boolean
          org_id?: string
          period_end?: string
          period_start?: string
          twin_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "workforce_observations_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_observations_twin_id_fkey"
            columns: ["twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
      workforce_review_cases: {
        Row: {
          case_rationale: Json
          computed_at: string
          confidence: string
          confidence_reason: string | null
          created_at: string
          data_completeness: number
          data_quality: Json
          fact_finding: Json
          factors: Json
          freshness: Json
          history_state: string
          id: string
          index: number
          limitations: Json
          missing_data: Json
          org_id: string
          period_end: string
          period_start: string
          priority: string
          priority_gate: Json
          seeking_growth: boolean
          sensitivity: Json
          source_version_hash: string
          trend: Json
          twin_id: string
          updated_at: string
        }
        Insert: {
          case_rationale?: Json
          computed_at?: string
          confidence?: string
          confidence_reason?: string | null
          created_at?: string
          data_completeness?: number
          data_quality?: Json
          fact_finding?: Json
          factors?: Json
          freshness?: Json
          history_state?: string
          id?: string
          index: number
          limitations?: Json
          missing_data?: Json
          org_id: string
          period_end: string
          period_start: string
          priority: string
          priority_gate?: Json
          seeking_growth?: boolean
          sensitivity?: Json
          source_version_hash: string
          trend?: Json
          twin_id: string
          updated_at?: string
        }
        Update: {
          case_rationale?: Json
          computed_at?: string
          confidence?: string
          confidence_reason?: string | null
          created_at?: string
          data_completeness?: number
          data_quality?: Json
          fact_finding?: Json
          factors?: Json
          freshness?: Json
          history_state?: string
          id?: string
          index?: number
          limitations?: Json
          missing_data?: Json
          org_id?: string
          period_end?: string
          period_start?: string
          priority?: string
          priority_gate?: Json
          seeking_growth?: boolean
          sensitivity?: Json
          source_version_hash?: string
          trend?: Json
          twin_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workforce_review_cases_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_review_cases_twin_id_fkey"
            columns: ["twin_id"]
            referencedRelation: "digital_twins"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      convert_candidate_to_employee: {
        Args: { p_req_id: string; p_twin_id: string }
        Returns: Json
      }
      current_twin: {
        Args: Record<PropertyKey, never>
        Returns: {
          attendance: Json
          audit_events: Json
          auth_user_id: string | null
          computed_fits: Json
          created_at: string
          delivery: Json
          department: string | null
          email: string
          id: string
          interview_rubrics: Json
          job_title: string | null
          manager_id: string | null
          name: string
          org_id: string | null
          performance_history: Json
          performance_synthesis: Json
          promotion_lag_months: number
          resume_text: string | null
          role: string
          seniority_level: number
          signals: Json
          status: string
          tenure_months: number
          updated_at: string
          verified_skills: Json
          work_location: string | null
          worker_type: string | null
        }
      }
      is_team_member: {
        Args: { check_twin_id: string }
        Returns: boolean
      }
      workflow_action_task_transition: {
        Args: {
          p_action: string
          p_actor_role: string
          p_actor_twin_id: string
          p_evidence: Json
          p_org_id: string
          p_outcome: Json
          p_reason: string
          p_request_id: string
          p_task_id: string
        }
        Returns: Json
      }
      workflow_recommendation_transition: {
        Args: {
          p_action: string
          p_actor_role: string
          p_actor_twin_id: string
          p_org_id: string
          p_payload: Json
          p_reason: string
          p_rec_id: string
          p_request_id: string
          p_source_version: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  realtime: {
    Tables: {
      messages: {
        Row: {
          event: string | null
          extension: string
          id: string
          inserted_at: string
          payload: Json | null
          private: boolean | null
          topic: string
          updated_at: string
        }
        Insert: {
          event?: string | null
          extension: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic: string
          updated_at?: string
        }
        Update: {
          event?: string | null
          extension?: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages_2026_09_17: {
        Row: {
          event: string | null
          extension: string
          id: string
          inserted_at: string
          payload: Json | null
          private: boolean | null
          topic: string
          updated_at: string
        }
        Insert: {
          event?: string | null
          extension: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic: string
          updated_at?: string
        }
        Update: {
          event?: string | null
          extension?: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages_2026_09_18: {
        Row: {
          event: string | null
          extension: string
          id: string
          inserted_at: string
          payload: Json | null
          private: boolean | null
          topic: string
          updated_at: string
        }
        Insert: {
          event?: string | null
          extension: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic: string
          updated_at?: string
        }
        Update: {
          event?: string | null
          extension?: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages_2026_09_19: {
        Row: {
          event: string | null
          extension: string
          id: string
          inserted_at: string
          payload: Json | null
          private: boolean | null
          topic: string
          updated_at: string
        }
        Insert: {
          event?: string | null
          extension: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic: string
          updated_at?: string
        }
        Update: {
          event?: string | null
          extension?: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages_2026_09_20: {
        Row: {
          event: string | null
          extension: string
          id: string
          inserted_at: string
          payload: Json | null
          private: boolean | null
          topic: string
          updated_at: string
        }
        Insert: {
          event?: string | null
          extension: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic: string
          updated_at?: string
        }
        Update: {
          event?: string | null
          extension?: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages_2026_09_21: {
        Row: {
          event: string | null
          extension: string
          id: string
          inserted_at: string
          payload: Json | null
          private: boolean | null
          topic: string
          updated_at: string
        }
        Insert: {
          event?: string | null
          extension: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic: string
          updated_at?: string
        }
        Update: {
          event?: string | null
          extension?: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      schema_migrations: {
        Row: {
          inserted_at: string | null
          version: number
        }
        Insert: {
          inserted_at?: string | null
          version: number
        }
        Update: {
          inserted_at?: string | null
          version?: number
        }
        Relationships: []
      }
      subscription: {
        Row: {
          claims: Json
          claims_role: unknown
          created_at: string
          entity: unknown
          filters: Database["realtime"]["CompositeTypes"]["user_defined_filter"][]
          id: number
          subscription_id: string
        }
        Insert: {
          claims: Json
          claims_role?: unknown
          created_at?: string
          entity: unknown
          filters?: Database["realtime"]["CompositeTypes"]["user_defined_filter"][]
          id?: never
          subscription_id: string
        }
        Update: {
          claims?: Json
          claims_role?: unknown
          created_at?: string
          entity?: unknown
          filters?: Database["realtime"]["CompositeTypes"]["user_defined_filter"][]
          id?: never
          subscription_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_rls: {
        Args: { max_record_bytes?: number; wal: Json }
        Returns: Database["realtime"]["CompositeTypes"]["wal_rls"][]
      }
      broadcast_changes: {
        Args: {
          event_name: string
          level?: string
          new: Record<string, unknown>
          old: Record<string, unknown>
          operation: string
          table_name: string
          table_schema: string
          topic_name: string
        }
        Returns: undefined
      }
      build_prepared_statement_sql: {
        Args: {
          columns: Database["realtime"]["CompositeTypes"]["wal_column"][]
          entity: unknown
          prepared_statement_name: string
        }
        Returns: string
      }
      cast: {
        Args: { type_: unknown; val: string }
        Returns: Json
      }
      check_equality_op: {
        Args: {
          op: Database["realtime"]["Enums"]["equality_op"]
          type_: unknown
          val_1: string
          val_2: string
        }
        Returns: boolean
      }
      is_visible_through_filters: {
        Args: {
          columns: Database["realtime"]["CompositeTypes"]["wal_column"][]
          filters: Database["realtime"]["CompositeTypes"]["user_defined_filter"][]
        }
        Returns: boolean
      }
      list_changes: {
        Args: {
          max_changes: number
          max_record_bytes: number
          publication: unknown
          slot_name: unknown
        }
        Returns: Database["realtime"]["CompositeTypes"]["wal_rls"][]
      }
      quote_wal2json: {
        Args: { entity: unknown }
        Returns: string
      }
      send: {
        Args: { event: string; payload: Json; private?: boolean; topic: string }
        Returns: undefined
      }
      to_regrole: {
        Args: { role_name: string }
        Returns: unknown
      }
      topic: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
    }
    Enums: {
      action: "INSERT" | "UPDATE" | "DELETE" | "TRUNCATE" | "ERROR"
      equality_op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in"
    }
    CompositeTypes: {
      user_defined_filter: {
        column_name: string | null
        op: Database["realtime"]["Enums"]["equality_op"] | null
        value: string | null
      }
      wal_column: {
        name: string | null
        type_name: string | null
        type_oid: unknown | null
        value: Json | null
        is_pkey: boolean | null
        is_selectable: boolean | null
      }
      wal_rls: {
        wal: Json | null
        is_rls_enabled: boolean | null
        subscription_ids: string[] | null
        errors: string[] | null
      }
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          format: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          format?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          format?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      config: {
        Row: {
          description: string | null
          key: string
          updated_at: string | null
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string | null
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string | null
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_bucket_id_fkey"
            columns: ["bucket_id"]
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_bucket_id_fkey"
            columns: ["bucket_id"]
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          level: number | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          level?: number | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          level?: number | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      prefixes: {
        Row: {
          bucket_id: string
          created_at: string | null
          level: number
          name: string
          updated_at: string | null
        }
        Insert: {
          bucket_id: string
          created_at?: string | null
          level?: number
          name: string
          updated_at?: string | null
        }
        Update: {
          bucket_id?: string
          created_at?: string | null
          level?: number
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prefixes_bucketId_fkey"
            columns: ["bucket_id"]
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_prefixes: {
        Args: { _bucket_id: string; _name: string }
        Returns: undefined
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      delete_prefix: {
        Args: { _bucket_id: string; _name: string }
        Returns: boolean
      }
      extension: {
        Args: { name: string }
        Returns: string
      }
      filename: {
        Args: { name: string }
        Returns: string
      }
      foldername: {
        Args: { name: string }
        Returns: string[]
      }
      get_level: {
        Args: { name: string }
        Returns: number
      }
      get_prefix: {
        Args: { name: string }
        Returns: string
      }
      get_prefixes: {
        Args: { name: string }
        Returns: string[]
      }
      get_size_by_bucket: {
        Args: Record<PropertyKey, never>
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          start_after?: string
        }
        Returns: {
          id: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_legacy_v1: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v1_optimised: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  supabase_functions: {
    Tables: {
      hooks: {
        Row: {
          created_at: string
          hook_name: string
          hook_table_id: number
          id: number
          request_id: number | null
        }
        Insert: {
          created_at?: string
          hook_name: string
          hook_table_id: number
          id?: number
          request_id?: number | null
        }
        Update: {
          created_at?: string
          hook_name?: string
          hook_table_id?: number
          id?: number
          request_id?: number | null
        }
        Relationships: []
      }
      migrations: {
        Row: {
          inserted_at: string
          version: string
        }
        Insert: {
          inserted_at?: string
          version: string
        }
        Update: {
          inserted_at?: string
          version?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  vault: {
    Tables: {
      secrets: {
        Row: {
          created_at: string
          description: string
          id: string
          key_id: string | null
          name: string | null
          nonce: string | null
          secret: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          key_id?: string | null
          name?: string | null
          nonce?: string | null
          secret: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          key_id?: string | null
          name?: string | null
          nonce?: string | null
          secret?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      decrypted_secrets: {
        Row: {
          created_at: string | null
          decrypted_secret: string | null
          description: string | null
          id: string | null
          key_id: string | null
          name: string | null
          nonce: string | null
          secret: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          decrypted_secret?: never
          description?: string | null
          id?: string | null
          key_id?: string | null
          name?: string | null
          nonce?: string | null
          secret?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          decrypted_secret?: never
          description?: string | null
          id?: string | null
          key_id?: string | null
          name?: string | null
          nonce?: string | null
          secret?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _crypto_aead_det_decrypt: {
        Args: {
          additional: string
          context?: string
          key_id: number
          message: string
          nonce?: string
        }
        Returns: string
      }
      _crypto_aead_det_encrypt: {
        Args: {
          additional: string
          context?: string
          key_id: number
          message: string
          nonce?: string
        }
        Returns: string
      }
      _crypto_aead_det_noncegen: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      create_secret: {
        Args: {
          new_description?: string
          new_key_id?: string
          new_name?: string
          new_secret: string
        }
        Returns: string
      }
      update_secret: {
        Args: {
          new_description?: string
          new_key_id?: string
          new_name?: string
          new_secret?: string
          secret_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
  _analytics: {
    Enums: {},
  },
  _realtime: {
    Enums: {},
  },
  auth: {
    Enums: {
      aal_level: ["aal1", "aal2", "aal3"],
      code_challenge_method: ["s256", "plain"],
      factor_status: ["unverified", "verified"],
      factor_type: ["totp", "webauthn", "phone"],
      oauth_authorization_status: ["pending", "approved", "denied", "expired"],
      oauth_client_type: ["public", "confidential"],
      oauth_registration_type: ["dynamic", "manual"],
      oauth_response_type: ["code"],
      one_time_token_type: [
        "confirmation_token",
        "reauthentication_token",
        "recovery_token",
        "email_change_token_new",
        "email_change_token_current",
        "phone_change_token",
      ],
    },
  },
  cron: {
    Enums: {},
  },
  extensions: {
    Enums: {},
  },
  graphql: {
    Enums: {},
  },
  graphql_public: {
    Enums: {},
  },
  net: {
    Enums: {
      request_status: ["PENDING", "SUCCESS", "ERROR"],
    },
  },
  pgbouncer: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
  realtime: {
    Enums: {
      action: ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "ERROR"],
      equality_op: ["eq", "neq", "lt", "lte", "gt", "gte", "in"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS"],
    },
  },
  supabase_functions: {
    Enums: {},
  },
  vault: {
    Enums: {},
  },
} as const
