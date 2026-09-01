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
  public: {
    Tables: {
      admin_capabilities: {
        Row: {
          created_at: string
          is_head: boolean
          is_owner: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          is_head?: boolean
          is_owner?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          is_head?: boolean
          is_owner?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_capabilities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "admin_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      admin_invite_codes: {
        Row: {
          active: boolean
          code_hash: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          label: string | null
          last_used_at: string | null
          max_uses: number
          used_count: number
        }
        Insert: {
          active?: boolean
          code_hash: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          max_uses?: number
          used_count?: number
        }
        Update: {
          active?: boolean
          code_hash?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          max_uses?: number
          used_count?: number
        }
        Relationships: []
      }
      admin_profiles: {
        Row: {
          created_at: string
          display_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      backline_content: {
        Row: {
          body_text: string | null
          content_type: string
          created_at: string
          file_name: string | null
          file_path: string | null
          id: string
          mime_type: string | null
          section_key: string
          title: string
          updated_at: string
        }
        Insert: {
          body_text?: string | null
          content_type?: string
          created_at?: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          mime_type?: string | null
          section_key: string
          title: string
          updated_at?: string
        }
        Update: {
          body_text?: string | null
          content_type?: string
          created_at?: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          mime_type?: string | null
          section_key?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      booking_groups: {
        Row: {
          created_at: string
          id: string
          kind: string
          recurrence: Database["public"]["Enums"]["recurrence_type"] | null
          recurrence_end: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          recurrence?: Database["public"]["Enums"]["recurrence_type"] | null
          recurrence_end?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          recurrence?: Database["public"]["Enums"]["recurrence_type"] | null
          recurrence_end?: string | null
        }
        Relationships: []
      }
      bookings: {
        Row: {
          approved_by: string | null
          color_b: number
          color_g: number
          color_r: number
          created_at: string
          end_time: string
          group_id: string | null
          id: string
          info: string | null
          name: string
          start_time: string
          status: Database["public"]["Enums"]["booking_status"]
          title: string
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          color_b?: number
          color_g?: number
          color_r?: number
          created_at?: string
          end_time: string
          group_id?: string | null
          id?: string
          info?: string | null
          name: string
          start_time: string
          status?: Database["public"]["Enums"]["booking_status"]
          title: string
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          color_b?: number
          color_g?: number
          color_r?: number
          created_at?: string
          end_time?: string
          group_id?: string | null
          id?: string
          info?: string | null
          name?: string
          start_time?: string
          status?: Database["public"]["Enums"]["booking_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bookings_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "booking_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          description: string | null
          end_date: string | null
          event_date: string
          id: string
          location: string | null
          media: Json
          poster_url: string | null
          setlist: Json
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          event_date: string
          id?: string
          location?: string | null
          media?: Json
          poster_url?: string | null
          setlist?: Json
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          event_date?: string
          id?: string
          location?: string | null
          media?: Json
          poster_url?: string | null
          setlist?: Json
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      site_contact_fields: {
        Row: {
          contact_id: string
          created_at: string
          field_type: string
          id: string
          label: string
          sort_order: number
          updated_at: string
          value: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          field_type?: string
          id?: string
          label: string
          sort_order?: number
          updated_at?: string
          value: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          field_type?: string
          id?: string
          label?: string
          sort_order?: number
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_contact_fields_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "site_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      site_contacts: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      telegram_channel_state: {
        Row: {
          chat_id: string | null
          dirty: boolean
          id: number
          message_id: number | null
          updated_at: string
          week_start: string | null
        }
        Insert: {
          chat_id?: string | null
          dirty?: boolean
          id?: number
          message_id?: number | null
          updated_at?: string
          week_start?: string | null
        }
        Update: {
          chat_id?: string | null
          dirty?: boolean
          id?: number
          message_id?: number | null
          updated_at?: string
          week_start?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_booking: { Args: { _booking_id: string }; Returns: undefined }
      approve_booking_group: { Args: { _group_id: string }; Returns: undefined }
      create_approved_booking_series: {
        Args: { payload: Json }
        Returns: {
          approved_by: string | null
          color_b: number
          color_g: number
          color_r: number
          created_at: string
          end_time: string
          group_id: string | null
          id: string
          info: string | null
          name: string
          start_time: string
          status: Database["public"]["Enums"]["booking_status"]
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      hash_admin_invite_code: {
        Args: { _invite_code: string }
        Returns: string
      }
      list_staff: {
        Args: never
        Returns: {
          display_name: string
          email: string
          is_banned: boolean
          is_head: boolean
          is_owner: boolean
          user_id: string
        }[]
      }
      security_is_valid_admin_invite: {
        Args: { _invite_code: string }
        Returns: boolean
      }
      security_rate_limit_blocked: {
        Args: {
          _max_attempts: number
          _scope: string
          _subject_hash: string
          _window: string
        }
        Returns: boolean
      }
      security_rate_limit_hit: {
        Args: {
          _max_attempts: number
          _scope: string
          _subject_hash: string
          _window: string
        }
        Returns: boolean
      }
      set_band_head: {
        Args: { _make_head: boolean; _target_user_id: string }
        Returns: undefined
      }
      submit_booking_request: { Args: { payload: Json }; Returns: Json }
      upsert_contact_fields: {
        Args: { _contact_id: string; _fields: Json }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user"
      booking_status: "pending" | "approved" | "rejected"
      recurrence_type: "none" | "daily" | "weekly" | "monthly"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "user"],
      booking_status: ["pending", "approved", "rejected"],
      recurrence_type: ["none", "daily", "weekly", "monthly"],
    },
  },
} as const
