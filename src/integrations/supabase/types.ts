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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      candidates: {
        Row: {
          bio: string | null
          created_at: string
          display_order: number | null
          election_id: string
          id: string
          name: string
          photo_url: string | null
          position: string
          slate: string | null
          updated_at: string
          vote_count: number | null
        }
        Insert: {
          bio?: string | null
          created_at?: string
          display_order?: number | null
          election_id: string
          id?: string
          name: string
          photo_url?: string | null
          position: string
          slate?: string | null
          updated_at?: string
          vote_count?: number | null
        }
        Update: {
          bio?: string | null
          created_at?: string
          display_order?: number | null
          election_id?: string
          id?: string
          name?: string
          photo_url?: string | null
          position?: string
          slate?: string | null
          updated_at?: string
          vote_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "candidates_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
        ]
      }
      elections: {
        Row: {
          blockchain_contract_address: string | null
          created_at: string
          description: string | null
          end_date: string
          id: string
          is_active: boolean | null
          start_date: string
          title: string
          updated_at: string
        }
        Insert: {
          blockchain_contract_address?: string | null
          created_at?: string
          description?: string | null
          end_date: string
          id?: string
          is_active?: boolean | null
          start_date: string
          title: string
          updated_at?: string
        }
        Update: {
          blockchain_contract_address?: string | null
          created_at?: string
          description?: string | null
          end_date?: string
          id?: string
          is_active?: boolean | null
          start_date?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      nft_transactions: {
        Row: {
          blockchain_network: string | null
          confirmed_at: string | null
          contract_address: string | null
          created_at: string
          election_id: string
          gas_fee: number | null
          id: string
          metadata: Json | null
          status: string | null
          token_id: string | null
          transaction_hash: string
          voter_id: string
        }
        Insert: {
          blockchain_network?: string | null
          confirmed_at?: string | null
          contract_address?: string | null
          created_at?: string
          election_id: string
          gas_fee?: number | null
          id?: string
          metadata?: Json | null
          status?: string | null
          token_id?: string | null
          transaction_hash: string
          voter_id: string
        }
        Update: {
          blockchain_network?: string | null
          confirmed_at?: string | null
          contract_address?: string | null
          created_at?: string
          election_id?: string
          gas_fee?: number | null
          id?: string
          metadata?: Json | null
          status?: string | null
          token_id?: string | null
          transaction_hash?: string
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nft_transactions_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          department: string | null
          email: string
          face_encoding: string | null
          first_name: string
          id: string
          last_name: string
          rfid_tag: string | null
          student_id: string | null
          updated_at: string
          year_level: number | null
        }
        Insert: {
          created_at?: string
          department?: string | null
          email: string
          face_encoding?: string | null
          first_name: string
          id: string
          last_name: string
          rfid_tag?: string | null
          student_id?: string | null
          updated_at?: string
          year_level?: number | null
        }
        Update: {
          created_at?: string
          department?: string | null
          email?: string
          face_encoding?: string | null
          first_name?: string
          id?: string
          last_name?: string
          rfid_tag?: string | null
          student_id?: string | null
          updated_at?: string
          year_level?: number | null
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
      voter_eligibility: {
        Row: {
          created_at: string
          election_id: string
          has_voted: boolean | null
          id: string
          is_honor_society_member: boolean | null
          is_icpep_member: boolean | null
          is_scc_member: boolean | null
          user_id: string
          voted_at: string | null
        }
        Insert: {
          created_at?: string
          election_id: string
          has_voted?: boolean | null
          id?: string
          is_honor_society_member?: boolean | null
          is_icpep_member?: boolean | null
          is_scc_member?: boolean | null
          user_id: string
          voted_at?: string | null
        }
        Update: {
          created_at?: string
          election_id?: string
          has_voted?: boolean | null
          id?: string
          is_honor_society_member?: boolean | null
          is_icpep_member?: boolean | null
          is_scc_member?: boolean | null
          user_id?: string
          voted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voter_eligibility_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
        ]
      }
      votes: {
        Row: {
          blockchain_timestamp: string | null
          candidate_id: string
          created_at: string
          election_id: string
          encrypted_vote: string
          id: string
          nft_transaction_hash: string | null
          voter_id: string
        }
        Insert: {
          blockchain_timestamp?: string | null
          candidate_id: string
          created_at?: string
          election_id: string
          encrypted_vote: string
          id?: string
          nft_transaction_hash?: string | null
          voter_id: string
        }
        Update: {
          blockchain_timestamp?: string | null
          candidate_id?: string
          created_at?: string
          election_id?: string
          encrypted_vote?: string
          id?: string
          nft_transaction_hash?: string | null
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "votes_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votes_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "voter"
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
      app_role: ["admin", "voter"],
    },
  },
} as const
