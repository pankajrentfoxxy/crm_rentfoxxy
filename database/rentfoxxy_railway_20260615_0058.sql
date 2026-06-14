--
-- PostgreSQL database dump
--

\restrict YaGzY79DfnMJjP83fTxtuhO0RBe3evHF9WeQPzd57Vo7xPiJdfTWiy4gcn9rBIn

-- Dumped from database version 18.4 (Debian 18.4-1.pgdg13+1)
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: update_lead_last_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_lead_last_activity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE leads SET last_activity_at = NOW()
  WHERE lead_id = NEW.lead_id;
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    activity_id integer NOT NULL,
    ticket_id integer,
    stage_id integer,
    user_id integer,
    action character varying(50) NOT NULL,
    notes text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: activities_activity_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activities_activity_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activities_activity_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activities_activity_id_seq OWNED BY public.activities.activity_id;


--
-- Name: allocation_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.allocation_logs (
    id integer NOT NULL,
    vendor_id integer,
    vendor_name character varying(255),
    serial_number character varying(255) NOT NULL,
    unique_id character varying(255),
    action_taken character varying(128),
    remarks text,
    qc_status character varying(64),
    in_ward character varying(32),
    out_ward character varying(32),
    extra jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id integer,
    customer_id integer,
    customer_name character varying(255),
    challan_id integer,
    product_id integer,
    model_name character varying(255),
    old_serial_number character varying(255),
    po_type character varying(64),
    purchase_type character varying(64),
    locking_period integer,
    added_date timestamp with time zone,
    failure_reason text,
    checked_by integer,
    assigned_to integer,
    warranty_status character varying(128),
    rental_status character varying(128),
    extra_details jsonb DEFAULT '{}'::jsonb,
    require_parts text,
    file_path text,
    log_type character varying(64),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: allocation_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.allocation_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: allocation_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.allocation_logs_id_seq OWNED BY public.allocation_logs.id;


--
-- Name: chip_level_repairs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chip_level_repairs (
    repair_id integer NOT NULL,
    ticket_id integer,
    created_by integer,
    updated_by integer,
    status character varying(50) DEFAULT 'in_progress'::character varying,
    issues text[] DEFAULT '{}'::text[],
    issue_notes text,
    parts_required boolean DEFAULT false,
    parts_notes text,
    resolved_checks text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chip_level_repairs_status_check CHECK (((status)::text = ANY ((ARRAY['in_progress'::character varying, 'waiting_parts'::character varying, 'completed'::character varying])::text[])))
);


--
-- Name: chip_level_repairs_repair_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chip_level_repairs_repair_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chip_level_repairs_repair_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chip_level_repairs_repair_id_seq OWNED BY public.chip_level_repairs.repair_id;


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    company_id integer NOT NULL,
    code character varying(20) NOT NULL,
    legal_name character varying(255) NOT NULL,
    gstin character varying(20),
    pan character varying(20),
    address text,
    state_code character varying(4),
    hsn_code character varying(20) DEFAULT '84713000'::character varying,
    logo_url text,
    dc_prefix character varying(12) NOT NULL,
    invoice_prefix character varying(12) NOT NULL,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    email character varying(255),
    phone character varying(32)
);


--
-- Name: companies_company_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.companies_company_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: companies_company_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.companies_company_id_seq OWNED BY public.companies.company_id;


--
-- Name: customer_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_addresses (
    customer_address_id integer NOT NULL,
    customer_id integer NOT NULL,
    concern_person character varying(255),
    mobile_no character varying(50),
    address text NOT NULL,
    pincode character varying(20),
    is_head_office boolean DEFAULT false,
    source_lead_address_id integer,
    address_type character varying(30),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: customer_addresses_customer_address_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_addresses_customer_address_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_addresses_customer_address_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_addresses_customer_address_id_seq OWNED BY public.customer_addresses.customer_address_id;


--
-- Name: customer_credit_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_credit_notes (
    credit_note_id integer NOT NULL,
    credit_note_number character varying(50) NOT NULL,
    customer_id integer NOT NULL,
    invoice_id integer,
    reason character varying(255) NOT NULL,
    description text,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    quantity integer DEFAULT 0,
    unit_rate numeric(12,2) DEFAULT 0,
    from_date date,
    to_date date,
    ttspl_ids jsonb DEFAULT '[]'::jsonb,
    status character varying(20) DEFAULT 'pending'::character varying,
    applied_in_invoice_id integer,
    created_by integer,
    approved_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT customer_credit_notes_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'applied'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: customer_credit_notes_credit_note_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_credit_notes_credit_note_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_credit_notes_credit_note_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_credit_notes_credit_note_id_seq OWNED BY public.customer_credit_notes.credit_note_id;


--
-- Name: customer_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_documents (
    doc_id integer NOT NULL,
    customer_id integer NOT NULL,
    lead_id integer,
    doc_type character varying(50) NOT NULL,
    doc_label character varying(255),
    file_path text NOT NULL,
    file_name character varying(255),
    file_size_bytes integer,
    uploaded_by integer,
    is_signed boolean DEFAULT false,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT customer_documents_doc_type_check CHECK (((doc_type)::text = ANY ((ARRAY['gst_certificate'::character varying, 'pan_card'::character varying, 'agreement'::character varying, 'kyc_id'::character varying, 'other'::character varying])::text[])))
);


--
-- Name: customer_documents_doc_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_documents_doc_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_documents_doc_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_documents_doc_id_seq OWNED BY public.customer_documents.doc_id;


--
-- Name: customer_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_inventory (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    asset_kind character varying(20) NOT NULL,
    asset_bucket character varying(20) DEFAULT 'live'::character varying NOT NULL,
    delivery_challan_id bigint,
    dc_number character varying(80),
    delivery_date timestamp with time zone,
    erp_serial_id character varying(80),
    serial_number character varying(120),
    unique_serial_number character varying(120),
    model_name character varying(300),
    generation character varying(80),
    screen_size character varying(80),
    ram character varying(120),
    storage character varying(200),
    gpu character varying(200),
    processor character varying(120),
    quotation_type character varying(40),
    rate character varying(80),
    locking_period integer,
    delivery_status character varying(80),
    delivery_type character varying(120),
    courier_name character varying(120),
    awb_number character varying(120),
    sales_status character varying(80),
    documents jsonb,
    erp_raw jsonb,
    synced_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    passivated_at timestamp with time zone,
    passivated_reason character varying(500),
    deprecated boolean DEFAULT true
);


--
-- Name: TABLE customer_inventory; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_inventory IS 'DEPRECATED 2026-06: ERP-era table. Customer holdings now derived from vendor_serial_numbers. Read-only / historical.';


--
-- Name: customer_inventory_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_inventory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_inventory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_inventory_id_seq OWNED BY public.customer_inventory.id;


--
-- Name: customer_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_invoices (
    invoice_id integer NOT NULL,
    invoice_number character varying(50) NOT NULL,
    customer_id integer NOT NULL,
    invoice_month integer NOT NULL,
    invoice_year integer NOT NULL,
    invoice_date date NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    subtotal numeric(12,2) DEFAULT 0,
    gst_percent numeric(5,2) DEFAULT 18,
    gst_amount numeric(12,2) DEFAULT 0,
    credit_note_adjustment numeric(12,2) DEFAULT 0,
    security_deposit numeric(12,2) DEFAULT 0,
    grand_total numeric(12,2) DEFAULT 0,
    status character varying(20) DEFAULT 'draft'::character varying,
    irn character varying(100),
    irn_generated_at timestamp with time zone,
    qr_code_url text,
    signed_qr_code text,
    eway_bill_number character varying(50),
    eway_bill_valid_till timestamp with time zone,
    pdf_path text,
    sent_at timestamp with time zone,
    sent_by integer,
    paid_at timestamp with time zone,
    payment_reference character varying(100),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    entity_code character varying(20),
    CONSTRAINT customer_invoices_invoice_month_check CHECK (((invoice_month >= 1) AND (invoice_month <= 12))),
    CONSTRAINT customer_invoices_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'sent'::character varying, 'paid'::character varying, 'overdue'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: customer_invoices_invoice_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_invoices_invoice_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_invoices_invoice_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_invoices_invoice_id_seq OWNED BY public.customer_invoices.invoice_id;


--
-- Name: customer_portal_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_portal_sessions (
    session_id integer NOT NULL,
    customer_id integer NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: customer_portal_sessions_session_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_portal_sessions_session_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_portal_sessions_session_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_portal_sessions_session_id_seq OWNED BY public.customer_portal_sessions.session_id;


--
-- Name: customer_security_deposits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_security_deposits (
    deposit_id integer NOT NULL,
    customer_id integer NOT NULL,
    sales_order_number character varying(50),
    amount numeric(12,2) NOT NULL,
    received_date date NOT NULL,
    status character varying(20) DEFAULT 'held'::character varying,
    refund_amount numeric(12,2) DEFAULT 0,
    refund_date date,
    refund_reference character varying(100),
    notes text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT customer_security_deposits_status_check CHECK (((status)::text = ANY ((ARRAY['held'::character varying, 'partially_refunded'::character varying, 'refunded'::character varying, 'adjusted'::character varying])::text[])))
);


--
-- Name: customer_security_deposits_deposit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_security_deposits_deposit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_security_deposits_deposit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_security_deposits_deposit_id_seq OWNED BY public.customer_security_deposits.deposit_id;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    customer_id integer NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255),
    phone character varying(50),
    gst_no character varying(50),
    type character varying(50) DEFAULT 'New'::character varying,
    details jsonb,
    address text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    status smallint DEFAULT 1 NOT NULL,
    company_name character varying(255),
    pan_number character varying(20),
    company_type character varying(100),
    company_size integer,
    industry character varying(100),
    billing_address text,
    billing_city character varying(100),
    billing_state character varying(100),
    billing_pincode character varying(10),
    shipping_same boolean DEFAULT true,
    shipping_address text,
    shipping_city character varying(100),
    shipping_state character varying(100),
    shipping_pincode character varying(10),
    whatsapp_number character varying(32),
    designation character varying(255),
    source_lead_stage character varying(100),
    onboarded_by integer,
    onboarded_at timestamp with time zone,
    portal_enabled boolean DEFAULT false,
    notes text,
    kyc_verified boolean DEFAULT false,
    kyc_verified_by integer,
    kyc_verified_at timestamp with time zone,
    source_lead_id integer,
    portal_password_hash text,
    portal_last_login timestamp with time zone,
    kyc_status character varying(20) DEFAULT 'pending'::character varying,
    kyc_documents jsonb DEFAULT '[]'::jsonb,
    CONSTRAINT customers_kyc_status_check CHECK (((kyc_status)::text = ANY ((ARRAY['pending'::character varying, 'submitted'::character varying, 'verified'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: customers_customer_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customers_customer_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customers_customer_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customers_customer_id_seq OWNED BY public.customers.customer_id;


--
-- Name: dc_qc_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dc_qc_tickets (
    id integer NOT NULL,
    dc_number character varying(50) NOT NULL,
    sales_order_number character varying(50),
    ticket_id integer NOT NULL,
    ttspl_id character varying(50),
    serial_id integer,
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT dc_qc_tickets_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'qc_passed'::character varying, 'qc_failed'::character varying])::text[])))
);


--
-- Name: dc_qc_tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dc_qc_tickets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dc_qc_tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dc_qc_tickets_id_seq OWNED BY public.dc_qc_tickets.id;


--
-- Name: delivery_challan_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_challan_lines (
    id integer NOT NULL,
    dc_number character varying(50) NOT NULL,
    sales_order_number character varying(50),
    quotation_number character varying(50),
    customer_id integer,
    customer_name character varying(255),
    email character varying(255),
    gst_number character varying(50),
    supply_state character varying(100),
    security_amount numeric(12,2) DEFAULT 0,
    shiping_charges numeric(12,2) DEFAULT 0,
    branch character varying(50),
    customer_billing_address jsonb,
    customer_shipping_address jsonb,
    brand character varying(100),
    model_name character varying(255),
    quantity integer DEFAULT 1 NOT NULL,
    main_qty integer,
    serial_number jsonb,
    ship_by character varying(20),
    courier_name character varying(255),
    awb_number character varying(100),
    delivery_person_id integer,
    remarks text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    pdf_path text,
    file_path text,
    delivered_serial_numbers jsonb,
    rejected_serial_numbers jsonb,
    pickuped_serial_numbers jsonb,
    submitted_remark text,
    submitted_name character varying(255),
    submitted_person_id integer,
    submitted_person_type character varying(50),
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    d_otp character varying(10),
    d_otp_verified_at timestamp with time zone,
    d_customer_name character varying(255),
    d_customer_email character varying(255),
    d_customer_mobile character varying(50),
    delivery_completed_at timestamp with time zone,
    date_and_time timestamp with time zone,
    latitude character varying(64),
    longitude character varying(64),
    old_rejected_serial_numbers jsonb,
    returned_serial_numbers jsonb,
    dispatch_mode character varying(20) DEFAULT 'courier'::character varying,
    porter_booking_id character varying(100),
    estimated_delivery date,
    pre_dispatch_qc_ticket_id integer,
    pre_dispatch_qc_passed boolean DEFAULT false,
    irn character varying(100),
    irn_generated_at timestamp with time zone,
    qr_code_url text,
    eway_bill_number character varying(50),
    eway_bill_valid_till timestamp with time zone,
    invoice_sent_at timestamp with time zone,
    invoice_sent_by integer,
    delivered_at timestamp with time zone,
    delivered_by integer,
    delivery_location text,
    delivery_otp character varying(10),
    delivery_otp_sent_at timestamp with time zone,
    pod_image_url text,
    rejection_reason text,
    entity_code character varying(20),
    CONSTRAINT delivery_challan_lines_dispatch_mode_check CHECK (((dispatch_mode)::text = ANY ((ARRAY['courier'::character varying, 'porter'::character varying, 'inhouse'::character varying])::text[]))),
    CONSTRAINT delivery_challan_lines_ship_by_check CHECK (((ship_by IS NULL) OR ((ship_by)::text = ANY ((ARRAY['by_hand'::character varying, 'by_courier'::character varying])::text[])))),
    CONSTRAINT delivery_challan_lines_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'shipped'::character varying, 'processing'::character varying, 'in_transit'::character varying, 'delivered'::character varying, 'rejected'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: delivery_challan_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.delivery_challan_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: delivery_challan_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.delivery_challan_lines_id_seq OWNED BY public.delivery_challan_lines.id;


--
-- Name: delivery_technicians; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_technicians (
    technician_id integer NOT NULL,
    user_id integer,
    first_name character varying(100) NOT NULL,
    last_name character varying(100),
    phone character varying(50),
    email character varying(255),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    country_code character varying(10) DEFAULT '91'::character varying NOT NULL,
    address text,
    identity_type character varying(50),
    identity_number character varying(100),
    identity_image jsonb DEFAULT '[]'::jsonb NOT NULL,
    image character varying(255),
    password_hash text
);


--
-- Name: delivery_technicians_technician_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.delivery_technicians_technician_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: delivery_technicians_technician_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.delivery_technicians_technician_id_seq OWNED BY public.delivery_technicians.technician_id;


--
-- Name: demo_agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demo_agreements (
    demo_id integer NOT NULL,
    sales_order_number character varying(50),
    dc_number character varying(50),
    customer_id integer NOT NULL,
    serial_id integer,
    ttspl_id character varying(64),
    delivered_at timestamp with time zone,
    decision_due_at timestamp with time zone,
    decision character varying(20) DEFAULT 'pending'::character varying,
    decided_at timestamp with time zone,
    decided_by integer,
    rent_start_date date,
    pickup_ticket_id integer,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT demo_agreements_decision_check CHECK (((decision)::text = ANY ((ARRAY['pending'::character varying, 'keep'::character varying, 'return'::character varying])::text[])))
);


--
-- Name: demo_agreements_demo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.demo_agreements_demo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: demo_agreements_demo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.demo_agreements_demo_id_seq OWNED BY public.demo_agreements.demo_id;


--
-- Name: diagnosis_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.diagnosis_images (
    image_id integer NOT NULL,
    diagnosis_id integer,
    section_name character varying(100),
    image_path text,
    uploaded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: diagnosis_images_image_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.diagnosis_images_image_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: diagnosis_images_image_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.diagnosis_images_image_id_seq OWNED BY public.diagnosis_images.image_id;


--
-- Name: diagnosis_parts_required; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.diagnosis_parts_required (
    id integer NOT NULL,
    diagnosis_id integer,
    ticket_id integer,
    part_name character varying(255) NOT NULL,
    part_category character varying(100),
    quantity integer DEFAULT 1,
    is_available boolean DEFAULT false,
    inventory_part_id integer,
    status character varying(50) DEFAULT 'Required'::character varying,
    attached_by integer,
    attached_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: diagnosis_parts_required_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.diagnosis_parts_required_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: diagnosis_parts_required_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.diagnosis_parts_required_id_seq OWNED BY public.diagnosis_parts_required.id;


--
-- Name: diagnosis_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.diagnosis_results (
    diagnosis_id integer NOT NULL,
    ticket_id integer,
    diagnosed_by integer,
    diagnosed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    power_on boolean,
    power_button_working boolean,
    boots_successfully boolean,
    bios_accessible boolean,
    bios_password_lock boolean,
    display_on boolean,
    brightness_control boolean,
    no_flickering boolean,
    no_lines_spots boolean,
    webcam_working boolean,
    all_keys_working boolean,
    touchpad_working boolean,
    left_click_working boolean,
    right_click_working boolean,
    battery_detected boolean,
    battery_charging boolean,
    charging_port_tight boolean,
    battery_swollen boolean,
    storage_detected boolean,
    smart_status_ok boolean,
    no_bad_sectors boolean,
    ram_detected boolean,
    correct_capacity boolean,
    slot_1_working boolean,
    slot_2_working boolean,
    wifi_detected boolean,
    wifi_connecting boolean,
    bluetooth_working boolean,
    usb_ports boolean,
    type_c boolean,
    hdmi boolean,
    audio_jack boolean,
    power_port boolean,
    fan_spinning boolean,
    no_abnormal_noise boolean,
    heating_normal boolean,
    no_short boolean,
    no_rust_liquid boolean,
    no_ic_heating boolean,
    bios_unlocked boolean,
    hdd_unlocked boolean,
    no_mdm_computrace boolean,
    power_issue_flag boolean DEFAULT false,
    display_replacement_required boolean DEFAULT false,
    keyboard_replacement_required boolean DEFAULT false,
    battery_replacement_required boolean DEFAULT false,
    storage_replacement_required boolean DEFAULT false,
    ram_slot_fault boolean DEFAULT false,
    network_card_check boolean DEFAULT false,
    port_repair_required boolean DEFAULT false,
    cleaning_paste_required boolean DEFAULT false,
    chip_level_repair_required boolean DEFAULT false,
    security_hold boolean DEFAULT false,
    total_failures integer DEFAULT 0,
    next_team text,
    remarks text,
    status character varying(50) DEFAULT 'In Progress'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: diagnosis_results_diagnosis_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.diagnosis_results_diagnosis_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: diagnosis_results_diagnosis_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.diagnosis_results_diagnosis_id_seq OWNED BY public.diagnosis_results.diagnosis_id;


--
-- Name: einvoice_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.einvoice_records (
    record_id integer NOT NULL,
    dc_number character varying(50) NOT NULL,
    invoice_id integer,
    customer_id integer,
    invoice_number character varying(50),
    irn character varying(100),
    ack_number character varying(100),
    ack_date timestamp with time zone,
    signed_invoice text,
    signed_qr_code text,
    qr_code_image_url text,
    status character varying(20) DEFAULT 'generated'::character varying,
    cancelled_at timestamp with time zone,
    cancel_reason character varying(255),
    zoho_response jsonb,
    generated_by integer,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT einvoice_records_status_check CHECK (((status)::text = ANY ((ARRAY['generated'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: einvoice_records_record_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.einvoice_records_record_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: einvoice_records_record_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.einvoice_records_record_id_seq OWNED BY public.einvoice_records.record_id;


--
-- Name: email_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_queue (
    email_id integer NOT NULL,
    to_email character varying(255) NOT NULL,
    subject text NOT NULL,
    body_text text,
    body_html text,
    dedupe_key character varying(255),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    scheduled_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    sent_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT email_queue_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'sent'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: email_queue_email_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_queue_email_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_queue_email_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_queue_email_id_seq OWNED BY public.email_queue.email_id;


--
-- Name: eway_bill_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eway_bill_records (
    record_id integer NOT NULL,
    dc_number character varying(50) NOT NULL,
    ewb_number character varying(50),
    ewb_date timestamp with time zone,
    valid_upto timestamp with time zone,
    transporter_id character varying(50),
    transporter_name character varying(100),
    vehicle_number character varying(20),
    mode_of_transport character varying(20) DEFAULT 'road'::character varying,
    distance_km integer,
    status character varying(20) DEFAULT 'active'::character varying,
    zoho_response jsonb,
    generated_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT eway_bill_records_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'extended'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: eway_bill_records_record_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.eway_bill_records_record_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: eway_bill_records_record_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.eway_bill_records_record_id_seq OWNED BY public.eway_bill_records.record_id;


--
-- Name: existing_customer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.existing_customer (
    customer_id integer NOT NULL,
    customer_name character varying(500),
    contact_person_name character varying(300),
    contact_person_number character varying(80),
    customer_number character varying(80),
    email character varying(320),
    billing_address jsonb,
    shipping_address jsonb,
    erp_raw jsonb,
    synced_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory (
    inventory_id integer NOT NULL,
    stock_type character varying(50) NOT NULL,
    device_type character varying(50) NOT NULL,
    machine_number character varying(100) NOT NULL,
    serial_number character varying(100) NOT NULL,
    brand character varying(100) NOT NULL,
    model character varying(100) NOT NULL,
    processor character varying(100),
    ram character varying(50),
    storage character varying(50),
    grade character varying(10),
    status character varying(50) DEFAULT 'In Stock'::character varying,
    stage character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    generation character varying(80),
    gpu character varying(120),
    screen_size character varying(40),
    CONSTRAINT inventory_device_type_check CHECK (((device_type)::text = ANY ((ARRAY['Laptop'::character varying, 'Desktop'::character varying])::text[]))),
    CONSTRAINT inventory_stock_type_check CHECK (((stock_type)::text = ANY ((ARRAY['Cooling Period'::character varying, 'Ready'::character varying])::text[])))
);


--
-- Name: inventory_inventory_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_inventory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_inventory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_inventory_id_seq OWNED BY public.inventory.inventory_id;


--
-- Name: inventory_status_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_status_transitions (
    transition_id integer NOT NULL,
    serial_id integer,
    ttspl_id character varying(64),
    from_status character varying(64),
    to_status character varying(64) NOT NULL,
    reason character varying(255),
    dc_number character varying(50),
    customer_id integer,
    entity_code character varying(20),
    actor_user_id integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: inventory_status_transitions_transition_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_status_transitions_transition_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_status_transitions_transition_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_status_transitions_transition_id_seq OWNED BY public.inventory_status_transitions.transition_id;


--
-- Name: inward_outward; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inward_outward (
    id integer NOT NULL,
    serial_number character varying(255),
    unique_number character varying(255),
    product_type character varying(64),
    transaction_type character varying(64),
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inward_outward_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inward_outward_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inward_outward_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inward_outward_id_seq OWNED BY public.inward_outward.id;


--
-- Name: laptop_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.laptop_catalog (
    catalog_id integer NOT NULL,
    brand character varying(100) NOT NULL,
    model character varying(120),
    processor character varying(120),
    generation character varying(80),
    ram character varying(50),
    storage character varying(50),
    device_type character varying(50) DEFAULT 'Laptop'::character varying,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: laptop_catalog_catalog_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.laptop_catalog_catalog_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: laptop_catalog_catalog_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.laptop_catalog_catalog_id_seq OWNED BY public.laptop_catalog.catalog_id;


--
-- Name: lead_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_activities (
    activity_id integer NOT NULL,
    lead_id integer,
    user_id integer,
    action character varying(50),
    status_from character varying(50),
    status_to character varying(50),
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    stage_from character varying(200),
    stage_to character varying(200)
);


--
-- Name: lead_activities_activity_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lead_activities_activity_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lead_activities_activity_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lead_activities_activity_id_seq OWNED BY public.lead_activities.activity_id;


--
-- Name: lead_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_addresses (
    address_id integer NOT NULL,
    lead_id integer NOT NULL,
    concern_person character varying(255),
    mobile_no character varying(32),
    address text NOT NULL,
    pincode character varying(20),
    address_type character varying(30),
    created_by integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: lead_addresses_address_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lead_addresses_address_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lead_addresses_address_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lead_addresses_address_id_seq OWNED BY public.lead_addresses.address_id;


--
-- Name: lead_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_assignments (
    assignment_id integer NOT NULL,
    lead_id integer,
    assigned_to integer,
    assigned_by integer,
    assigned_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    batch_id uuid
);


--
-- Name: lead_assignments_assignment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lead_assignments_assignment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lead_assignments_assignment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lead_assignments_assignment_id_seq OWNED BY public.lead_assignments.assignment_id;


--
-- Name: lead_auto_assign_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_auto_assign_config (
    id integer NOT NULL,
    user_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
    round_robin_index integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by integer
);


--
-- Name: lead_auto_assign_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lead_auto_assign_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lead_auto_assign_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lead_auto_assign_config_id_seq OWNED BY public.lead_auto_assign_config.id;


--
-- Name: lead_company_research; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_company_research (
    research_id integer NOT NULL,
    lead_id integer,
    cin character varying(100),
    entity_type character varying(100),
    roc character varying(100),
    revenue character varying(100),
    employees character varying(100),
    gst character varying(100),
    address text,
    city character varying(100),
    state character varying(100),
    raw_response jsonb,
    researched_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    industry character varying(255),
    pincode character varying(20)
);


--
-- Name: lead_company_research_research_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lead_company_research_research_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lead_company_research_research_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lead_company_research_research_id_seq OWNED BY public.lead_company_research.research_id;


--
-- Name: lead_followup_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_followup_notifications (
    notification_id integer NOT NULL,
    lead_id integer,
    follow_up_at timestamp with time zone NOT NULL,
    recipient_email character varying(255) NOT NULL,
    channel character varying(20) DEFAULT 'email'::character varying NOT NULL,
    notified_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: lead_followup_notifications_notification_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lead_followup_notifications_notification_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lead_followup_notifications_notification_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lead_followup_notifications_notification_id_seq OWNED BY public.lead_followup_notifications.notification_id;


--
-- Name: lead_import_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_import_logs (
    import_id integer NOT NULL,
    imported_by integer,
    total_rows integer DEFAULT 0,
    imported integer DEFAULT 0,
    duplicates integer DEFAULT 0,
    errors integer DEFAULT 0,
    error_details jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: lead_import_logs_import_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lead_import_logs_import_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lead_import_logs_import_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lead_import_logs_import_id_seq OWNED BY public.lead_import_logs.import_id;


--
-- Name: lead_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_orders (
    lead_order_id integer NOT NULL,
    lead_id integer,
    order_status character varying(50) DEFAULT 'New'::character varying,
    amount numeric(10,2) DEFAULT 0,
    details jsonb,
    created_by integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: lead_orders_lead_order_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lead_orders_lead_order_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lead_orders_lead_order_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lead_orders_lead_order_id_seq OWNED BY public.lead_orders.lead_order_id;


--
-- Name: lead_remarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_remarks (
    remark_id integer NOT NULL,
    lead_id integer NOT NULL,
    user_id integer,
    note text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: lead_remarks_remark_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lead_remarks_remark_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lead_remarks_remark_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lead_remarks_remark_id_seq OWNED BY public.lead_remarks.remark_id;


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    lead_id integer NOT NULL,
    name character varying(255) NOT NULL,
    company_name character varying(255),
    email character varying(255),
    phone character varying(50),
    city character varying(100),
    source character varying(100),
    status character varying(50) DEFAULT 'Pending'::character varying NOT NULL,
    assigned_user_id integer,
    assigned_by integer,
    assigned_at timestamp with time zone,
    follow_up_date timestamp with time zone,
    is_duplicate boolean DEFAULT false,
    duplicate_of integer,
    rejection_reason text,
    research_status character varying(50) DEFAULT 'pending'::character varying,
    research_requested_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    lead_stage character varying(200),
    quotation_accept_token character varying(64),
    quotation_accepted_at timestamp with time zone,
    quotation_last_sent_at timestamp with time zone,
    quotation_last_estimate_no character varying(50),
    quotation_last_to_email character varying(255),
    whatsapp_number character varying(32),
    designation character varying(255),
    quantity_required integer,
    monthly_budget numeric(12,2),
    rental_duration integer,
    use_case character varying(100),
    company_type character varying(100),
    company_size integer,
    industry character varying(100),
    annual_revenue character varying(100),
    pan_number character varying(20),
    gst_number character varying(20),
    state character varying(100),
    pincode character varying(10),
    billing_address text,
    shipping_same_as_billing boolean DEFAULT true,
    shipping_address text,
    follow_up_time time without time zone,
    converted_at timestamp with time zone,
    converted_by integer,
    customer_id integer,
    inquiry_type character varying(50) DEFAULT 'rental'::character varying,
    last_activity_at timestamp with time zone DEFAULT now(),
    company_brand character varying(255),
    brand character varying(100),
    processor character varying(100),
    generation character varying(50),
    ram character varying(50),
    storage character varying(50),
    personal_remarks text,
    CONSTRAINT leads_inquiry_type_check CHECK (((inquiry_type)::text = ANY ((ARRAY['rental'::character varying, 'sales'::character varying, 'both'::character varying])::text[]))),
    CONSTRAINT leads_research_status_check CHECK (((research_status)::text = ANY ((ARRAY['pending'::character varying, 'completed'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT leads_status_check CHECK (((status)::text = ANY ((ARRAY['Pending'::character varying, 'Cold'::character varying, 'Warm'::character varying, 'Hot'::character varying, 'Gone'::character varying, 'Hold'::character varying, 'Rejected'::character varying, 'Call Back'::character varying, 'Deal'::character varying, 'Demo'::character varying])::text[])))
);


--
-- Name: leads_lead_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.leads_lead_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leads_lead_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.leads_lead_id_seq OWNED BY public.leads.lead_id;


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    item_id integer NOT NULL,
    order_id integer,
    brand character varying(100),
    processor character varying(100),
    ram character varying(50),
    storage character varying(50),
    quantity integer DEFAULT 1,
    preferred_model character varying(100),
    status character varying(50) DEFAULT 'New'::character varying,
    inventory_id integer,
    unit_price numeric(10,2) DEFAULT 0,
    gst_percent numeric(5,2) DEFAULT 18,
    gst_amount numeric(10,2) DEFAULT 0,
    total_with_gst numeric(10,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    qc_passed boolean DEFAULT false,
    is_wfh boolean DEFAULT false,
    shipping_charge numeric(10,2) DEFAULT 0,
    estimate_id character varying(120),
    destination_pincode character varying(20),
    tracking_status character varying(30) DEFAULT 'Not Dispatched'::character varying,
    item_tracker_id character varying(120),
    item_courier_partner character varying(120),
    item_dispatch_date date,
    item_estimated_delivery date,
    delivered_at timestamp with time zone,
    proposed_delivery_date date,
    qc_sales_checklist jsonb,
    qc_sales_passed_at timestamp with time zone
);


--
-- Name: order_items_item_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_items_item_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_items_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.order_items_item_id_seq OWNED BY public.order_items.item_id;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    order_id integer NOT NULL,
    customer_id integer,
    lead_type character varying(50),
    order_type character varying(20) DEFAULT 'Sales'::character varying,
    status character varying(50) DEFAULT 'New Lead'::character varying,
    owner_user_id integer,
    lockin_period_days integer DEFAULT 0,
    security_amount numeric(10,2) DEFAULT 0,
    is_wfh boolean DEFAULT false,
    shipping_charge numeric(10,2) DEFAULT 0,
    shipping_gst_amount numeric(10,2) DEFAULT 0,
    subtotal_amount numeric(12,2) DEFAULT 0,
    items_gst_amount numeric(12,2) DEFAULT 0,
    grand_total_amount numeric(12,2) DEFAULT 0,
    invoice_number character varying(100),
    invoice_generated_at timestamp with time zone,
    eway_bill_number character varying(100),
    eway_bill_generated_at timestamp with time zone,
    delivery_date date,
    shipping_address text,
    dispatch_date date,
    tracker_id character varying(100),
    courier_partner character varying(100),
    dispatched_at timestamp with time zone,
    estimated_delivery date,
    qc_received_at timestamp with time zone,
    qc_completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    cancelled_at timestamp with time zone,
    cancelled_by integer,
    CONSTRAINT orders_order_type_check CHECK (((order_type)::text = ANY ((ARRAY['Sales'::character varying, 'Rent'::character varying, 'Demo'::character varying])::text[])))
);


--
-- Name: orders_order_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.orders_order_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orders_order_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.orders_order_id_seq OWNED BY public.orders.order_id;


--
-- Name: part_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_requests (
    request_id integer NOT NULL,
    ticket_id integer,
    requested_by integer,
    part_name character varying(255) NOT NULL,
    description text,
    status character varying(50) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: part_requests_request_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.part_requests_request_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: part_requests_request_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.part_requests_request_id_seq OWNED BY public.part_requests.request_id;


--
-- Name: parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parts (
    part_id integer NOT NULL,
    part_name character varying(100) NOT NULL,
    part_type character varying(50),
    quantity integer DEFAULT 0,
    vendor character varying(100),
    cost numeric(10,2),
    location_code character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    min_threshold integer DEFAULT 5,
    description text,
    category character varying(100) DEFAULT 'general'::character varying
);


--
-- Name: parts_part_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.parts_part_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: parts_part_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.parts_part_id_seq OWNED BY public.parts.part_id;


--
-- Name: permission_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission_audit_logs (
    id integer NOT NULL,
    actor_user_id integer,
    target_type character varying(32) NOT NULL,
    target_id character varying(100),
    action character varying(64) NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: permission_audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permission_audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permission_audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permission_audit_logs_id_seq OWNED BY public.permission_audit_logs.id;


--
-- Name: permission_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission_sections (
    id integer NOT NULL,
    section character varying(100) NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: permission_sections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permission_sections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permission_sections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permission_sections_id_seq OWNED BY public.permission_sections.id;


--
-- Name: photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photos (
    photo_id integer NOT NULL,
    ticket_id integer,
    stage_id integer,
    photo_url text NOT NULL,
    photo_type character varying(20),
    uploaded_by integer,
    uploaded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT photos_photo_type_check CHECK (((photo_type)::text = ANY ((ARRAY['before'::character varying, 'after'::character varying, 'issue'::character varying, 'repair'::character varying])::text[])))
);


--
-- Name: photos_photo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.photos_photo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: photos_photo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.photos_photo_id_seq OWNED BY public.photos.photo_id;


--
-- Name: procurement_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_requests (
    request_id integer NOT NULL,
    order_item_id integer,
    status character varying(50) DEFAULT 'New'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: procurement_requests_request_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_requests_request_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_requests_request_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_requests_request_id_seq OWNED BY public.procurement_requests.request_id;


--
-- Name: vendor_product_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_product_details (
    product_detail_id integer NOT NULL,
    po_id integer,
    category character varying(128),
    brand character varying(255),
    model character varying(255),
    processor character varying(255),
    generation character varying(128),
    ram character varying(64),
    storage character varying(128),
    gpu character varying(128),
    screen_size character varying(64),
    quantity integer DEFAULT 1 NOT NULL,
    rate numeric(18,2) DEFAULT 0 NOT NULL,
    remarks text,
    total_amount numeric(18,2),
    vendor_locking_period integer,
    warranty integer,
    parts integer,
    status character varying(64),
    random_id character varying(64),
    old_product_id integer,
    old_product_details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_details; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.product_details AS
 SELECT product_detail_id AS id,
    po_id,
    category,
    brand,
    model,
    processor,
    generation,
    ram,
    storage,
    gpu,
    screen_size,
    quantity,
    rate,
    remarks,
    total_amount,
    vendor_locking_period,
    warranty,
    parts,
    status,
    random_id,
    old_product_id,
    old_product_details,
    created_at,
    updated_at
   FROM public.vendor_product_details;


--
-- Name: VIEW product_details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.product_details IS 'Laravel product_details parity — backed by vendor_product_details';


--
-- Name: qc_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qc_photos (
    photo_id integer NOT NULL,
    qc_id integer,
    photo_path text NOT NULL,
    uploaded_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE qc_photos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.qc_photos IS 'Optional photos for QC failures or issues';


--
-- Name: qc_photos_photo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qc_photos_photo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qc_photos_photo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qc_photos_photo_id_seq OWNED BY public.qc_photos.photo_id;


--
-- Name: qc_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qc_results (
    qc_id integer NOT NULL,
    ticket_id integer,
    qc_stage character varying(10) NOT NULL,
    processor character varying(20),
    generation character varying(20),
    storage_type character varying(50),
    ram_size character varying(20),
    checklist_data jsonb NOT NULL,
    parts_replaced boolean DEFAULT false,
    replaced_parts jsonb,
    qc_result character varying(20),
    failure_reasons text[],
    remarks text,
    final_grade character varying(50),
    grade_notes text,
    tested_by integer,
    checked_by integer,
    qc_date date,
    dispatch_date date,
    is_locked boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    submitted_at timestamp without time zone,
    CONSTRAINT qc_results_qc_stage_check CHECK (((qc_stage)::text = ANY ((ARRAY['QC1'::character varying, 'QC2'::character varying])::text[])))
);


--
-- Name: TABLE qc_results; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.qc_results IS 'QC-1 and QC-2 quality check results with grading';


--
-- Name: qc_results_qc_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qc_results_qc_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qc_results_qc_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qc_results_qc_id_seq OWNED BY public.qc_results.qc_id;


--
-- Name: qc_round_robin_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qc_round_robin_state (
    team_id integer NOT NULL,
    last_assigned_user_id integer,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: rent_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rent_devices (
    id integer NOT NULL,
    serial_id integer NOT NULL,
    po_id integer,
    dc_number character varying(64),
    serial_number character varying(255),
    unique_number character varying(255),
    product_id integer,
    rent_start_date date,
    rent_end_date date,
    rent_amount numeric(12,2),
    month_rent numeric(12,2),
    rent_with_gst numeric(12,2),
    total_amount numeric(12,2),
    vendor_id integer,
    type character varying(64),
    status character varying(64),
    customer_id integer,
    rent_stop_date date,
    rent_start_date_again date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rent_devices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rent_devices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rent_devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rent_devices_id_seq OWNED BY public.rent_devices.id;


--
-- Name: repair_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_logs (
    id integer NOT NULL,
    serial_number_id integer NOT NULL,
    serial_number character varying(255),
    unique_number character varying(255),
    new_serial_number character varying(255),
    new_unique_number character varying(255),
    repair_start_date date,
    repair_end_date date,
    type character varying(64),
    remarks text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: repair_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.repair_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: repair_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.repair_logs_id_seq OWNED BY public.repair_logs.id;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    id integer NOT NULL,
    role character varying(50) NOT NULL,
    section character varying(100) NOT NULL,
    can_view boolean DEFAULT false,
    can_create boolean DEFAULT false,
    can_edit boolean DEFAULT false,
    can_delete boolean DEFAULT false
);


--
-- Name: role_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.role_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: role_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.role_permissions_id_seq OWNED BY public.role_permissions.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    name character varying(50) NOT NULL,
    display_name character varying(100) NOT NULL,
    description text,
    is_system_role boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: sales_order_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_order_lines (
    id integer NOT NULL,
    sales_order_number character varying(50) NOT NULL,
    quotation_number character varying(50) DEFAULT 'N/A'::character varying NOT NULL,
    customer_id integer,
    customer_name character varying(255),
    customer_email character varying(255),
    customer_mobile character varying(50),
    customer_shipping_address jsonb,
    customer_billing_address jsonb,
    gst_number character varying(50),
    supply_state character varying(100),
    security_amount numeric(12,2) DEFAULT 0,
    shiping_charges numeric(12,2) DEFAULT 0,
    quotation_type character varying(20) DEFAULT 'rental'::character varying,
    branch character varying(50),
    brand character varying(100),
    model_name character varying(255),
    processor character varying(100),
    generation character varying(50),
    ram character varying(50),
    storage character varying(50),
    gpu character varying(100),
    screen_size character varying(50),
    quantity integer DEFAULT 1 NOT NULL,
    main_qty integer DEFAULT 1 NOT NULL,
    rate numeric(12,2) DEFAULT 0 NOT NULL,
    locking_period integer,
    battery_charger_warranty integer,
    technical_warranty integer,
    remark text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    token character varying(64),
    pdf_path text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    entity_code character varying(20),
    security_type character varying(20) DEFAULT 'none'::character varying
);


--
-- Name: sales_order_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_order_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_order_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_order_lines_id_seq OWNED BY public.sales_order_lines.id;


--
-- Name: sales_order_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_order_payments (
    payment_id integer NOT NULL,
    sales_order_number character varying(50) NOT NULL,
    customer_id integer,
    payment_type character varying(30) NOT NULL,
    amount numeric(12,2) NOT NULL,
    payment_date date NOT NULL,
    payment_mode character varying(30) DEFAULT 'bank_transfer'::character varying,
    reference_number character varying(100),
    notes text,
    recorded_by integer,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sales_order_payments_payment_mode_check CHECK (((payment_mode)::text = ANY ((ARRAY['bank_transfer'::character varying, 'cheque'::character varying, 'upi'::character varying, 'cash'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT sales_order_payments_payment_type_check CHECK (((payment_type)::text = ANY ((ARRAY['advance'::character varying, 'security_deposit'::character varying, 'monthly'::character varying, 'partial'::character varying, 'final'::character varying])::text[])))
);


--
-- Name: sales_order_payments_payment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_order_payments_payment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_order_payments_payment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_order_payments_payment_id_seq OWNED BY public.sales_order_payments.payment_id;


--
-- Name: sales_order_serials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_order_serials (
    allocation_id integer NOT NULL,
    sales_order_number character varying(50) NOT NULL,
    line_id integer,
    serial_id integer,
    ttspl_id character varying(64),
    serial_number character varying(255),
    qc_ticket_id integer,
    qc_status character varying(20) DEFAULT 'pending'::character varying,
    status character varying(20) DEFAULT 'attached'::character varying,
    dc_number character varying(50),
    entity_code character varying(20),
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sales_order_serials_qc_status_check CHECK (((qc_status)::text = ANY ((ARRAY['pending'::character varying, 'passed'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT sales_order_serials_status_check CHECK (((status)::text = ANY ((ARRAY['attached'::character varying, 'dispatched'::character varying, 'removed'::character varying])::text[])))
);


--
-- Name: sales_order_serials_allocation_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_order_serials_allocation_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_order_serials_allocation_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_order_serials_allocation_id_seq OWNED BY public.sales_order_serials.allocation_id;


--
-- Name: sales_quotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_quotations (
    id integer NOT NULL,
    quotation_number character varying(50) NOT NULL,
    customer_id integer,
    customer_name character varying(255),
    customer_email character varying(255),
    customer_mobile character varying(50),
    customer_shipping_address jsonb,
    customer_billing_address jsonb,
    contact_person_name character varying(255),
    contact_person_mobile character varying(50),
    gst_number character varying(50),
    supply_state character varying(100),
    security_amount numeric(12,2) DEFAULT 0,
    shiping_charges numeric(12,2) DEFAULT 0,
    quotation_type character varying(20) DEFAULT 'rental'::character varying,
    brand character varying(100),
    model_name character varying(255),
    processor character varying(100),
    generation character varying(50),
    ram character varying(50),
    storage character varying(50),
    gpu character varying(100),
    screen_size character varying(50),
    quantity integer DEFAULT 1 NOT NULL,
    main_quantity integer DEFAULT 1 NOT NULL,
    rate numeric(12,2) DEFAULT 0 NOT NULL,
    locking_period integer,
    battery_charger_warranty integer,
    technical_warranty integer,
    remark text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    token character varying(64),
    pdf_path text,
    status_updated_by_id integer,
    status_updated_by_name character varying(50),
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_lead_id integer,
    entity_code character varying(20),
    security_type character varying(20) DEFAULT 'none'::character varying,
    CONSTRAINT sales_quotations_quotation_type_check CHECK (((quotation_type)::text = ANY ((ARRAY['sale'::character varying, 'rental'::character varying, 'demo'::character varying])::text[]))),
    CONSTRAINT sales_quotations_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: sales_quotations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_quotations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_quotations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_quotations_id_seq OWNED BY public.sales_quotations.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    name character varying(255) NOT NULL,
    applied_at timestamp with time zone DEFAULT now()
);


--
-- Name: vendor_serial_numbers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_serial_numbers (
    serial_id integer NOT NULL,
    po_id integer,
    grn_id integer NOT NULL,
    serial_number character varying(255) NOT NULL,
    extra jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    spo_id integer,
    inventory_asset_code character varying(32),
    rental_start_date date,
    qc_status character varying(64),
    inventory_status character varying(64),
    remark text,
    current_customer_id integer,
    current_dc_number character varying(50),
    current_entity character varying(20),
    dispatch_mode character varying(20),
    dispatched_at timestamp with time zone,
    delivered_at timestamp with time zone,
    returned_at timestamp with time zone,
    rent_start_date date,
    rent_end_date date,
    rent_monthly_rate numeric(12,2),
    status_changed_at timestamp with time zone,
    CONSTRAINT vendor_serial_po_or_spo_chk CHECK ((((po_id IS NOT NULL) AND (spo_id IS NULL)) OR ((po_id IS NULL) AND (spo_id IS NOT NULL))))
);


--
-- Name: serial_number_parts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.serial_number_parts AS
 SELECT serial_id AS id,
    spo_id AS po_id,
    grn_id AS goods_receipts_id,
    serial_number,
    COALESCE(inventory_asset_code, ((extra ->> 'unique_product_serial'::text))::character varying) AS unique_product_serial,
    COALESCE(NULLIF(TRIM(BOTH FROM qc_status), ''::text), NULLIF(TRIM(BOTH FROM (extra ->> 'status'::text)), ''::text), 'pending'::text) AS status,
    (extra ->> 'main_serial_number'::text) AS main_serial_number,
    (extra ->> 'main_unique_number'::text) AS main_unique_number,
    remark,
    extra,
    created_at,
    updated_at
   FROM public.vendor_serial_numbers s
  WHERE ((deleted_at IS NULL) AND (spo_id IS NOT NULL));


--
-- Name: VIEW serial_number_parts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.serial_number_parts IS 'Laravel serial_number_parts parity — vendor_serial_numbers with spo_id';


--
-- Name: serial_numbers; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.serial_numbers AS
 SELECT serial_id AS id,
    po_id,
    grn_id AS goods_receipts_id,
    serial_number,
    COALESCE(inventory_asset_code, ((extra ->> 'unique_product_serial'::text))::character varying) AS unique_product_serial,
    COALESCE(NULLIF(TRIM(BOTH FROM qc_status), ''::text), NULLIF(TRIM(BOTH FROM (extra ->> 'status'::text)), ''::text), 'pending'::text) AS status,
    COALESCE(inventory_status, ((extra ->> 'status2'::text))::character varying) AS status2,
    remark,
    (extra ->> 'product_id'::text) AS product_id,
    (extra ->> 'product_warranty'::text) AS product_warranty,
    rental_start_date AS rental_period,
    (extra ->> 'require_parts'::text) AS require_parts,
    (extra ->> 'file_path'::text) AS file_path,
    (extra ->> 'came_from'::text) AS came_from,
    (extra ->> 'action_status'::text) AS action_status,
    (extra ->> 'action_remark'::text) AS action_remark,
    (extra ->> 'vendor_name'::text) AS vendor_name,
    extra AS extra_json,
    created_at,
    updated_at
   FROM public.vendor_serial_numbers s
  WHERE ((deleted_at IS NULL) AND (po_id IS NOT NULL));


--
-- Name: VIEW serial_numbers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.serial_numbers IS 'Laravel serial_numbers parity — backed by vendor_serial_numbers';


--
-- Name: sm_courier_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_courier_details (
    id integer NOT NULL,
    courier_name character varying(255) NOT NULL,
    awb_number character varying(100) NOT NULL,
    dc_number character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sm_courier_details_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sm_courier_details_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sm_courier_details_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sm_courier_details_id_seq OWNED BY public.sm_courier_details.id;


--
-- Name: sm_document_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_document_sequences (
    doc_type character varying(20) NOT NULL,
    last_value integer DEFAULT 0 NOT NULL,
    prefix character varying(20) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: spare_parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spare_parts (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    status smallint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: spare_parts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.spare_parts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: spare_parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.spare_parts_id_seq OWNED BY public.spare_parts.id;


--
-- Name: stage_checklists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stage_checklists (
    checklist_id integer NOT NULL,
    stage_id integer,
    checklist_items jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: stage_checklists_checklist_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stage_checklists_checklist_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stage_checklists_checklist_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stage_checklists_checklist_id_seq OWNED BY public.stage_checklists.checklist_id;


--
-- Name: stage_transition_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stage_transition_rules (
    rule_id integer NOT NULL,
    from_stage_name character varying(100) NOT NULL,
    to_stage_name character varying(100) NOT NULL,
    condition character varying(100),
    is_backward boolean DEFAULT false,
    notes text
);


--
-- Name: stage_transition_rules_rule_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stage_transition_rules_rule_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stage_transition_rules_rule_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stage_transition_rules_rule_id_seq OWNED BY public.stage_transition_rules.rule_id;


--
-- Name: stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stages (
    stage_id integer NOT NULL,
    stage_name character varying(100) NOT NULL,
    stage_order integer NOT NULL,
    team_id integer,
    stage_category character varying(100),
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: stages_stage_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stages_stage_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stages_stage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stages_stage_id_seq OWNED BY public.stages.stage_id;


--
-- Name: support_issue_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_issue_categories (
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: support_issue_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_issue_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_issue_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_issue_categories_id_seq OWNED BY public.support_issue_categories.id;


--
-- Name: support_replacement_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_replacement_orders (
    id integer NOT NULL,
    ticket_id integer NOT NULL,
    item_id integer NOT NULL,
    source_item_id integer,
    old_customer_inventory_id integer,
    new_customer_inventory_id integer,
    old_machine_serial character varying(120),
    new_machine_serial character varying(120),
    status character varying(40) DEFAULT 'placed'::character varying NOT NULL,
    created_by integer,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    dispatched_at timestamp with time zone,
    delivered_at timestamp with time zone,
    inventory_updated_at timestamp with time zone,
    complaint_item_id integer,
    pickup_item_id integer,
    dispatch_method character varying(20),
    courier_name character varying(200),
    awb_number character varying(120),
    delivery_otp_code character varying(6),
    delivery_otp_verified_at timestamp with time zone,
    warehouse_otp_code character varying(6),
    warehouse_otp_verified_at timestamp with time zone,
    flagged_at timestamp with time zone,
    approved_at timestamp with time zone,
    out_for_delivery_at timestamp with time zone,
    pickup_completed_at timestamp with time zone
);


--
-- Name: support_replacement_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_replacement_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_replacement_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_replacement_orders_id_seq OWNED BY public.support_replacement_orders.id;


--
-- Name: support_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_settings (
    key character varying(80) NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: support_ticket_item_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_ticket_item_audit (
    id integer NOT NULL,
    item_id integer,
    ticket_id integer NOT NULL,
    user_id integer,
    action character varying(80) NOT NULL,
    detail jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: support_ticket_item_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_ticket_item_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_ticket_item_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_ticket_item_audit_id_seq OWNED BY public.support_ticket_item_audit.id;


--
-- Name: support_ticket_item_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_ticket_item_comments (
    id integer NOT NULL,
    item_id integer NOT NULL,
    user_id integer NOT NULL,
    author_role character varying(40),
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: support_ticket_item_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_ticket_item_comments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_ticket_item_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_ticket_item_comments_id_seq OWNED BY public.support_ticket_item_comments.id;


--
-- Name: support_ticket_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_ticket_items (
    id integer NOT NULL,
    ticket_id integer NOT NULL,
    customer_inventory_id integer,
    serial_number character varying(120),
    unique_serial_number character varying(120),
    brand character varying(120),
    model character varying(300),
    ram character varying(120),
    storage character varying(200),
    generation character varying(80),
    item_type character varying(20) NOT NULL,
    issue_category_id integer,
    issue_category_label character varying(120),
    remarks text,
    assigned_to integer,
    status character varying(40) DEFAULT 'open'::character varying NOT NULL,
    otp_code character varying(6),
    otp_verified_at timestamp with time zone,
    pod_image_path text,
    work_done_at timestamp with time zone,
    loan_machine_serial character varying(120),
    loan_delivered_at timestamp with time zone,
    pickup_scheduled_at timestamp with time zone,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    visited_at timestamp with time zone,
    picked_up_at timestamp with time zone,
    replacement_flagged_by integer,
    replacement_flag_reason text,
    replacement_approved_by integer,
    replacement_approved_at timestamp with time zone,
    source_item_id integer,
    current_step character varying(50),
    outcome character varying(30),
    outcome_set_by integer,
    outcome_set_at timestamp with time zone,
    pod_uploaded_at timestamp with time zone,
    warehouse_otp_code character varying(6),
    warehouse_otp_verified_at timestamp with time zone,
    pickup_method character varying(20),
    pickup_assigned_to integer,
    pickup_courier_name character varying(200),
    pickup_awb character varying(120),
    pickup_completed_at timestamp with time zone
);


--
-- Name: support_ticket_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_ticket_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_ticket_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_ticket_items_id_seq OWNED BY public.support_ticket_items.id;


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_tickets (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    customer_name character varying(500),
    customer_phone character varying(80),
    status character varying(40) DEFAULT 'open'::character varying NOT NULL,
    created_by integer,
    closed_by integer,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    last_activity_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    priority character varying(20) DEFAULT 'normal'::character varying NOT NULL,
    top_level_remarks text,
    ticket_phone_override character varying(80),
    ticket_alt_phone character varying(80),
    ticket_email character varying(320),
    ticket_address text,
    created_by_name character varying(300),
    ticket_category character varying(20) DEFAULT 'complaint'::character varying,
    return_dc_number character varying(50),
    complaint_type character varying(50),
    serial_number character varying(120),
    unique_number character varying(120),
    delivery_person_id integer,
    assigned_parts jsonb DEFAULT '[]'::jsonb NOT NULL,
    replaced_parts jsonb DEFAULT '[]'::jsonb NOT NULL,
    ttspl_id character varying(50),
    dc_number character varying(50),
    sales_order_number character varying(50),
    customer_portal_ticket boolean DEFAULT false,
    portal_customer_id integer
);


--
-- Name: support_tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_tickets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_tickets_id_seq OWNED BY public.support_tickets.id;


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    team_id integer NOT NULL,
    team_name character varying(100) NOT NULL,
    manager_id integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: teams_team_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teams_team_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: teams_team_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teams_team_id_seq OWNED BY public.teams.team_id;


--
-- Name: ticket_checklist_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_checklist_progress (
    id integer NOT NULL,
    ticket_id integer,
    stage_id integer,
    checklist_data jsonb NOT NULL,
    completed_by integer,
    completed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: ticket_checklist_progress_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_checklist_progress_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_checklist_progress_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_checklist_progress_id_seq OWNED BY public.ticket_checklist_progress.id;


--
-- Name: ticket_parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_parts (
    id integer NOT NULL,
    ticket_id integer,
    part_id integer,
    quantity_used integer NOT NULL,
    notes text,
    added_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    unit_cost numeric(10,2) DEFAULT 0,
    is_upgrade boolean DEFAULT false
);


--
-- Name: ticket_parts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_parts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_parts_id_seq OWNED BY public.ticket_parts.id;


--
-- Name: ticket_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_services (
    service_id integer NOT NULL,
    ticket_id integer,
    service_type character varying(255) NOT NULL,
    cost numeric(10,2) DEFAULT 0 NOT NULL,
    added_by integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: ticket_services_service_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_services_service_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_services_service_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_services_service_id_seq OWNED BY public.ticket_services.service_id;


--
-- Name: tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tickets (
    ticket_id integer NOT NULL,
    serial_number character varying(100) NOT NULL,
    ttspl_id character varying(100),
    machine_number character varying(100),
    brand character varying(50),
    model character varying(100),
    processor character varying(100),
    ram character varying(50),
    storage character varying(50),
    status character varying(50) DEFAULT 'in_progress'::character varying,
    priority character varying(20) DEFAULT 'normal'::character varying,
    current_stage_id integer,
    assigned_team_id integer,
    assigned_user_id integer,
    initial_condition text,
    final_grade character varying(10),
    initial_cost numeric(10,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamp with time zone,
    vendor_serial_id integer,
    ticket_type character varying(50) DEFAULT 'grn_qc'::character varying,
    qc_fail_count integer DEFAULT 0,
    qc1_failed_at timestamp with time zone,
    qc2_failed_at timestamp with time zone,
    qc1_fail_reason text,
    qc2_fail_reason text,
    qc1_passed_at timestamp with time zone,
    qc2_passed_at timestamp with time zone,
    body_paint_required boolean DEFAULT false,
    chip_repair_required boolean DEFAULT false,
    highlighted boolean DEFAULT false,
    highlighted_reason text,
    floor_manager_qc_failed boolean DEFAULT false,
    floor_manager_qc_failed_at timestamp with time zone,
    floor_manager_qc_fail_reason text,
    return_to_vendor_dc_number character varying(50),
    sales_order_id integer,
    sales_order_number character varying(50),
    CONSTRAINT tickets_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'normal'::character varying, 'high'::character varying, 'urgent'::character varying])::text[]))),
    CONSTRAINT tickets_status_check CHECK (((status)::text = ANY ((ARRAY['in_progress'::character varying, 'completed'::character varying, 'failed'::character varying, 'on_hold'::character varying])::text[]))),
    CONSTRAINT tickets_ticket_type_check CHECK (((ticket_type)::text = ANY ((ARRAY['grn_qc'::character varying, 'sales_order_qc'::character varying, 'support'::character varying, 'general'::character varying])::text[])))
);


--
-- Name: tickets_ticket_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tickets_ticket_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tickets_ticket_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tickets_ticket_id_seq OWNED BY public.tickets.ticket_id;


--
-- Name: ttspl_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ttspl_audit_log (
    log_id integer NOT NULL,
    ttspl_id character varying(50) NOT NULL,
    vendor_serial_id integer,
    event_type character varying(80) NOT NULL,
    description text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    actor_user_id integer,
    actor_name character varying(255),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ttspl_audit_log_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ttspl_audit_log_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ttspl_audit_log_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ttspl_audit_log_log_id_seq OWNED BY public.ttspl_audit_log.log_id;


--
-- Name: ttspl_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ttspl_config_history (
    history_id integer NOT NULL,
    ttspl_id character varying(50) NOT NULL,
    vendor_serial_id integer,
    ticket_id integer,
    changed_by integer,
    change_type character varying(50) NOT NULL,
    field_name character varying(50) NOT NULL,
    old_value text,
    new_value text,
    notes text,
    part_used_id integer,
    part_cost numeric(10,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ttspl_config_history_change_type_check CHECK (((change_type)::text = ANY ((ARRAY['upgrade'::character varying, 'replacement'::character varying, 'correction'::character varying, 'initial'::character varying])::text[])))
);


--
-- Name: ttspl_config_history_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ttspl_config_history_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ttspl_config_history_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ttspl_config_history_history_id_seq OWNED BY public.ttspl_config_history.history_id;


--
-- Name: user_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_permissions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    section character varying(100) NOT NULL,
    can_view boolean,
    can_create boolean,
    can_edit boolean,
    can_delete boolean,
    granted_by integer,
    granted_at timestamp without time zone DEFAULT now()
);


--
-- Name: user_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_permissions_id_seq OWNED BY public.user_permissions.id;


--
-- Name: user_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_teams (
    user_id integer NOT NULL,
    team_id integer NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    name character varying(100) NOT NULL,
    email character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(50) NOT NULL,
    team_id integer,
    active boolean DEFAULT true,
    barcode character varying(100),
    permissions text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(20) DEFAULT 'active'::character varying,
    user_type character varying(20) DEFAULT 'internal'::character varying,
    approved_by integer,
    approved_at timestamp without time zone,
    rejection_reason text,
    company_name character varying(255),
    gst_number character varying(50),
    mobile_no character varying(50),
    last_login timestamp with time zone,
    last_login_ip character varying(50),
    deactivated_at timestamp with time zone,
    deactivated_by integer,
    deactivation_reason text,
    profile_photo_url text,
    designation character varying(100),
    department character varying(100),
    employee_id character varying(50),
    joining_date date,
    notes text,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['super_admin'::character varying, 'admin'::character varying, 'manager'::character varying, 'team_member'::character varying, 'team_lead'::character varying, 'sales'::character varying, 'floor_manager'::character varying, 'procurement'::character varying, 'qc'::character varying, 'dispatch'::character varying, 'warehouse'::character varying, 'accounts'::character varying, 'support_lead'::character varying, 'support_tech'::character varying, 'customer'::character varying, 'vendor'::character varying, 'technician'::character varying])::text[]))),
    CONSTRAINT users_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'pending_approval'::character varying, 'rejected'::character varying, 'blocked'::character varying, 'inactive'::character varying])::text[]))),
    CONSTRAINT users_user_type_check CHECK (((user_type)::text = ANY ((ARRAY['internal'::character varying, 'customer'::character varying, 'vendor'::character varying, 'technician'::character varying])::text[])))
);


--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_user_id_seq OWNED BY public.users.user_id;


--
-- Name: vendor_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_audit_logs (
    log_id integer NOT NULL,
    actor_user_id integer,
    vendor_id integer,
    entity_type character varying(64) NOT NULL,
    entity_id character varying(64),
    action character varying(64) NOT NULL,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vendor_audit_logs_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_audit_logs_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_audit_logs_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_audit_logs_log_id_seq OWNED BY public.vendor_audit_logs.log_id;


--
-- Name: vendor_billing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_billing (
    billing_id integer NOT NULL,
    vendor_id integer,
    billing_month integer NOT NULL,
    billing_year integer NOT NULL,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    assigned_to_user_id integer,
    totals jsonb DEFAULT '{}'::jsonb,
    detail jsonb DEFAULT '[]'::jsonb,
    file_path text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT vendor_billing_billing_month_check CHECK (((billing_month >= 1) AND (billing_month <= 12)))
);


--
-- Name: vendor_billing_billing_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_billing_billing_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_billing_billing_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_billing_billing_id_seq OWNED BY public.vendor_billing.billing_id;


--
-- Name: vendor_debit_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_debit_notes (
    debit_note_id integer NOT NULL,
    debit_note_number character varying(50) NOT NULL,
    vendor_id integer NOT NULL,
    po_id integer,
    reason character varying(255) NOT NULL,
    description text,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    quantity integer DEFAULT 0,
    unit_rate numeric(12,2) DEFAULT 0,
    ttspl_ids jsonb DEFAULT '[]'::jsonb,
    status character varying(20) DEFAULT 'pending'::character varying,
    adjusted_in_bill_id integer,
    created_by integer,
    approved_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT vendor_debit_notes_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'adjusted'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: vendor_debit_notes_debit_note_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_debit_notes_debit_note_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_debit_notes_debit_note_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_debit_notes_debit_note_id_seq OWNED BY public.vendor_debit_notes.debit_note_id;


--
-- Name: vendor_goods_received_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_goods_received_notes (
    grn_id integer NOT NULL,
    po_id integer,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    spo_id integer,
    bill_status character varying(20) DEFAULT 'pending'::character varying,
    bill_files jsonb DEFAULT '[]'::jsonb NOT NULL,
    bill_name character varying(255),
    CONSTRAINT vendor_goods_received_notes_bill_status_check CHECK (((bill_status)::text = ANY ((ARRAY['pending'::character varying, 'received'::character varying])::text[]))),
    CONSTRAINT vendor_grn_po_or_spo_chk CHECK ((((po_id IS NOT NULL) AND (spo_id IS NULL)) OR ((po_id IS NULL) AND (spo_id IS NOT NULL))))
);


--
-- Name: vendor_goods_received_notes_grn_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_goods_received_notes_grn_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_goods_received_notes_grn_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_goods_received_notes_grn_id_seq OWNED BY public.vendor_goods_received_notes.grn_id;


--
-- Name: vendor_inventory_asset_sequence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_inventory_asset_sequence (
    id smallint DEFAULT 1 NOT NULL,
    next_num integer DEFAULT 1 NOT NULL,
    CONSTRAINT vendor_inventory_asset_sequence_id_check CHECK ((id = 1))
);


--
-- Name: vendor_monthly_bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_monthly_bills (
    bill_id integer NOT NULL,
    bill_number character varying(50) NOT NULL,
    vendor_id integer NOT NULL,
    bill_month integer NOT NULL,
    bill_year integer NOT NULL,
    bill_date date NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    subtotal numeric(12,2) DEFAULT 0,
    gst_amount numeric(12,2) DEFAULT 0,
    debit_note_adjustment numeric(12,2) DEFAULT 0,
    total_payable numeric(12,2) DEFAULT 0,
    status character varying(20) DEFAULT 'generated'::character varying,
    payment_date date,
    payment_reference character varying(100),
    notes text,
    generated_by integer,
    approved_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT vendor_monthly_bills_status_check CHECK (((status)::text = ANY ((ARRAY['generated'::character varying, 'approved'::character varying, 'paid'::character varying, 'disputed'::character varying])::text[])))
);


--
-- Name: vendor_monthly_bills_bill_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_monthly_bills_bill_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_monthly_bills_bill_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_monthly_bills_bill_id_seq OWNED BY public.vendor_monthly_bills.bill_id;


--
-- Name: vendor_portal_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_portal_sessions (
    session_id integer NOT NULL,
    vendor_id integer NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: vendor_portal_sessions_session_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_portal_sessions_session_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_portal_sessions_session_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_portal_sessions_session_id_seq OWNED BY public.vendor_portal_sessions.session_id;


--
-- Name: vendor_product_details_product_detail_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_product_details_product_detail_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_product_details_product_detail_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_product_details_product_detail_id_seq OWNED BY public.vendor_product_details.product_detail_id;


--
-- Name: vendor_product_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_product_inventory (
    id integer NOT NULL,
    product_id integer,
    serial_id integer NOT NULL,
    serial_number character varying(255) NOT NULL,
    unique_product_serial character varying(255),
    product_model_name character varying(255),
    status character varying(64) DEFAULT 'in_stock'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vendor_product_inventory_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_product_inventory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_product_inventory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_product_inventory_id_seq OWNED BY public.vendor_product_inventory.id;


--
-- Name: vendor_purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_purchase_orders (
    po_id integer NOT NULL,
    purchase_order_number character varying(64) NOT NULL,
    purchase_order_date date NOT NULL,
    purchase_order_type character varying(64) NOT NULL,
    vendor_id integer NOT NULL,
    po_state character varying(128) NOT NULL,
    is_same_state boolean DEFAULT false NOT NULL,
    sub_total_amount numeric(18,2) DEFAULT 0 NOT NULL,
    total_amount numeric(18,2) DEFAULT 0 NOT NULL,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    assets_details jsonb,
    product_details_legacy_ids jsonb,
    remarks text,
    public_token uuid DEFAULT gen_random_uuid() NOT NULL,
    status character varying(64) DEFAULT 'draft'::character varying NOT NULL,
    invoice_created boolean DEFAULT false NOT NULL,
    invoice_path text,
    rental_period character varying(128),
    status_updated_by_admin_id integer,
    status_updated_by_name character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    bill_name character varying(255),
    bill_files jsonb DEFAULT '[]'::jsonb NOT NULL,
    expected_delivery_date date,
    rejection_reason text,
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    sent_to_vendor_at timestamp with time zone,
    vendor_invoice_number character varying(100),
    vendor_invoice_file text,
    vendor_invoice_uploaded_at timestamp with time zone
);


--
-- Name: vendor_purchase_orders_po_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_purchase_orders_po_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_purchase_orders_po_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_purchase_orders_po_id_seq OWNED BY public.vendor_purchase_orders.po_id;


--
-- Name: vendor_refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_refresh_tokens (
    id integer NOT NULL,
    vendor_id integer NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vendor_refresh_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_refresh_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_refresh_tokens_id_seq OWNED BY public.vendor_refresh_tokens.id;


--
-- Name: vendor_replaced_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_replaced_products (
    replaced_id integer NOT NULL,
    vendor_id integer,
    po_id integer,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(64) DEFAULT 'open'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: vendor_replaced_products_replaced_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_replaced_products_replaced_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_replaced_products_replaced_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_replaced_products_replaced_id_seq OWNED BY public.vendor_replaced_products.replaced_id;


--
-- Name: vendor_serial_number_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_serial_number_audit (
    audit_id integer NOT NULL,
    po_id integer NOT NULL,
    grn_id integer NOT NULL,
    old_serial character varying(255) NOT NULL,
    new_serial character varying(255) NOT NULL,
    changed_by_user_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vendor_serial_number_audit_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_serial_number_audit_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_serial_number_audit_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_serial_number_audit_audit_id_seq OWNED BY public.vendor_serial_number_audit.audit_id;


--
-- Name: vendor_serial_numbers_serial_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_serial_numbers_serial_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_serial_numbers_serial_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_serial_numbers_serial_id_seq OWNED BY public.vendor_serial_numbers.serial_id;


--
-- Name: vendor_shops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_shops (
    shop_id integer NOT NULL,
    vendor_id integer NOT NULL,
    name character varying(255) NOT NULL,
    address text,
    contact character varying(32),
    image_url text,
    banner_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: vendor_shops_shop_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_shops_shop_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_shops_shop_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_shops_shop_id_seq OWNED BY public.vendor_shops.shop_id;


--
-- Name: vendor_spare_parts_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_spare_parts_catalog (
    part_id integer NOT NULL,
    name character varying(255) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vendor_spare_parts_catalog_part_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_spare_parts_catalog_part_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_spare_parts_catalog_part_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_spare_parts_catalog_part_id_seq OWNED BY public.vendor_spare_parts_catalog.part_id;


--
-- Name: vendor_spare_parts_purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_spare_parts_purchase_orders (
    spo_id integer NOT NULL,
    purchase_order_number character varying(64) CONSTRAINT vendor_spare_parts_purchase_orde_purchase_order_number_not_null NOT NULL,
    purchase_order_date date NOT NULL,
    vendor_id integer NOT NULL,
    po_state character varying(128) NOT NULL,
    is_same_state boolean DEFAULT false NOT NULL,
    sub_total_amount numeric(18,2) DEFAULT 0 NOT NULL,
    total_amount numeric(18,2) DEFAULT 0 NOT NULL,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    assets_details jsonb,
    remarks text,
    public_token uuid DEFAULT gen_random_uuid() NOT NULL,
    status character varying(64) DEFAULT 'draft'::character varying NOT NULL,
    status_updated_by_admin_id integer,
    status_updated_by_name character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    bill_name character varying(255),
    bill_files jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: vendor_spare_parts_purchase_orders_spo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_spare_parts_purchase_orders_spo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_spare_parts_purchase_orders_spo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_spare_parts_purchase_orders_spo_id_seq OWNED BY public.vendor_spare_parts_purchase_orders.spo_id;


--
-- Name: vendor_wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_wallets (
    wallet_id integer NOT NULL,
    vendor_id integer NOT NULL,
    withdrawn numeric(18,2) DEFAULT 0 NOT NULL,
    commission_given numeric(18,2) DEFAULT 0 NOT NULL,
    total_earning numeric(18,2) DEFAULT 0 NOT NULL,
    pending_withdraw numeric(18,2) DEFAULT 0 NOT NULL,
    delivery_charge_earned numeric(18,2) DEFAULT 0 NOT NULL,
    collected_cash numeric(18,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vendor_wallets_wallet_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_wallets_wallet_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_wallets_wallet_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_wallets_wallet_id_seq OWNED BY public.vendor_wallets.wallet_id;


--
-- Name: vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendors (
    vendor_id integer NOT NULL,
    status character varying(32) DEFAULT 'approved'::character varying NOT NULL,
    first_name character varying(255) NOT NULL,
    last_name character varying(255),
    business_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(32) NOT NULL,
    password_hash text NOT NULL,
    address text NOT NULL,
    business_type character varying(255) NOT NULL,
    registration_date date NOT NULL,
    state character varying(128) NOT NULL,
    gst_number character varying(64),
    brand_code character varying(64),
    business_registration_number character varying(128),
    tax_identification_number character varying(128),
    bank_name character varying(255) NOT NULL,
    account_number character varying(64) NOT NULL,
    bank_ifsc_code character varying(32) NOT NULL,
    account_holder_name character varying(255) NOT NULL,
    image_url text,
    licenses_url text,
    remember_pass_plain text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    vendor_portal_password_hash text,
    vendor_portal_last_login timestamp with time zone,
    vendor_portal_enabled boolean DEFAULT true NOT NULL,
    po_payment_terms character varying(50) DEFAULT 'postpaid_monthly'::character varying,
    credit_days integer DEFAULT 1,
    pan_number character varying(20),
    msme_number character varying(50),
    contact_person_name character varying(255),
    contact_person_phone character varying(32),
    alternate_phone character varying(32),
    city character varying(100),
    pincode character varying(10),
    logo_url text,
    notes text
);


--
-- Name: vendors_vendor_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendors_vendor_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendors_vendor_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendors_vendor_id_seq OWNED BY public.vendors.vendor_id;


--
-- Name: work_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_logs (
    log_id integer NOT NULL,
    ticket_id integer,
    user_id integer,
    stage_id integer,
    start_time timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    end_time timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: work_logs_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_logs_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_logs_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_logs_log_id_seq OWNED BY public.work_logs.log_id;


--
-- Name: activities activity_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities ALTER COLUMN activity_id SET DEFAULT nextval('public.activities_activity_id_seq'::regclass);


--
-- Name: allocation_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allocation_logs ALTER COLUMN id SET DEFAULT nextval('public.allocation_logs_id_seq'::regclass);


--
-- Name: chip_level_repairs repair_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chip_level_repairs ALTER COLUMN repair_id SET DEFAULT nextval('public.chip_level_repairs_repair_id_seq'::regclass);


--
-- Name: companies company_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies ALTER COLUMN company_id SET DEFAULT nextval('public.companies_company_id_seq'::regclass);


--
-- Name: customer_addresses customer_address_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_addresses ALTER COLUMN customer_address_id SET DEFAULT nextval('public.customer_addresses_customer_address_id_seq'::regclass);


--
-- Name: customer_credit_notes credit_note_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_credit_notes ALTER COLUMN credit_note_id SET DEFAULT nextval('public.customer_credit_notes_credit_note_id_seq'::regclass);


--
-- Name: customer_documents doc_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_documents ALTER COLUMN doc_id SET DEFAULT nextval('public.customer_documents_doc_id_seq'::regclass);


--
-- Name: customer_inventory id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_inventory ALTER COLUMN id SET DEFAULT nextval('public.customer_inventory_id_seq'::regclass);


--
-- Name: customer_invoices invoice_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invoices ALTER COLUMN invoice_id SET DEFAULT nextval('public.customer_invoices_invoice_id_seq'::regclass);


--
-- Name: customer_portal_sessions session_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_portal_sessions ALTER COLUMN session_id SET DEFAULT nextval('public.customer_portal_sessions_session_id_seq'::regclass);


--
-- Name: customer_security_deposits deposit_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_security_deposits ALTER COLUMN deposit_id SET DEFAULT nextval('public.customer_security_deposits_deposit_id_seq'::regclass);


--
-- Name: customers customer_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers ALTER COLUMN customer_id SET DEFAULT nextval('public.customers_customer_id_seq'::regclass);


--
-- Name: dc_qc_tickets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_qc_tickets ALTER COLUMN id SET DEFAULT nextval('public.dc_qc_tickets_id_seq'::regclass);


--
-- Name: delivery_challan_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_challan_lines ALTER COLUMN id SET DEFAULT nextval('public.delivery_challan_lines_id_seq'::regclass);


--
-- Name: delivery_technicians technician_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_technicians ALTER COLUMN technician_id SET DEFAULT nextval('public.delivery_technicians_technician_id_seq'::regclass);


--
-- Name: demo_agreements demo_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_agreements ALTER COLUMN demo_id SET DEFAULT nextval('public.demo_agreements_demo_id_seq'::regclass);


--
-- Name: diagnosis_images image_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnosis_images ALTER COLUMN image_id SET DEFAULT nextval('public.diagnosis_images_image_id_seq'::regclass);


--
-- Name: diagnosis_parts_required id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnosis_parts_required ALTER COLUMN id SET DEFAULT nextval('public.diagnosis_parts_required_id_seq'::regclass);


--
-- Name: diagnosis_results diagnosis_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnosis_results ALTER COLUMN diagnosis_id SET DEFAULT nextval('public.diagnosis_results_diagnosis_id_seq'::regclass);


--
-- Name: einvoice_records record_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einvoice_records ALTER COLUMN record_id SET DEFAULT nextval('public.einvoice_records_record_id_seq'::regclass);


--
-- Name: email_queue email_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_queue ALTER COLUMN email_id SET DEFAULT nextval('public.email_queue_email_id_seq'::regclass);


--
-- Name: eway_bill_records record_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eway_bill_records ALTER COLUMN record_id SET DEFAULT nextval('public.eway_bill_records_record_id_seq'::regclass);


--
-- Name: inventory inventory_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory ALTER COLUMN inventory_id SET DEFAULT nextval('public.inventory_inventory_id_seq'::regclass);


--
-- Name: inventory_status_transitions transition_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_status_transitions ALTER COLUMN transition_id SET DEFAULT nextval('public.inventory_status_transitions_transition_id_seq'::regclass);


--
-- Name: inward_outward id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inward_outward ALTER COLUMN id SET DEFAULT nextval('public.inward_outward_id_seq'::regclass);


--
-- Name: laptop_catalog catalog_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.laptop_catalog ALTER COLUMN catalog_id SET DEFAULT nextval('public.laptop_catalog_catalog_id_seq'::regclass);


--
-- Name: lead_activities activity_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activities ALTER COLUMN activity_id SET DEFAULT nextval('public.lead_activities_activity_id_seq'::regclass);


--
-- Name: lead_addresses address_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_addresses ALTER COLUMN address_id SET DEFAULT nextval('public.lead_addresses_address_id_seq'::regclass);


--
-- Name: lead_assignments assignment_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_assignments ALTER COLUMN assignment_id SET DEFAULT nextval('public.lead_assignments_assignment_id_seq'::regclass);


--
-- Name: lead_auto_assign_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_auto_assign_config ALTER COLUMN id SET DEFAULT nextval('public.lead_auto_assign_config_id_seq'::regclass);


--
-- Name: lead_company_research research_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_company_research ALTER COLUMN research_id SET DEFAULT nextval('public.lead_company_research_research_id_seq'::regclass);


--
-- Name: lead_followup_notifications notification_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_followup_notifications ALTER COLUMN notification_id SET DEFAULT nextval('public.lead_followup_notifications_notification_id_seq'::regclass);


--
-- Name: lead_import_logs import_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_import_logs ALTER COLUMN import_id SET DEFAULT nextval('public.lead_import_logs_import_id_seq'::regclass);


--
-- Name: lead_orders lead_order_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_orders ALTER COLUMN lead_order_id SET DEFAULT nextval('public.lead_orders_lead_order_id_seq'::regclass);


--
-- Name: lead_remarks remark_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_remarks ALTER COLUMN remark_id SET DEFAULT nextval('public.lead_remarks_remark_id_seq'::regclass);


--
-- Name: leads lead_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads ALTER COLUMN lead_id SET DEFAULT nextval('public.leads_lead_id_seq'::regclass);


--
-- Name: order_items item_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items ALTER COLUMN item_id SET DEFAULT nextval('public.order_items_item_id_seq'::regclass);


--
-- Name: orders order_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders ALTER COLUMN order_id SET DEFAULT nextval('public.orders_order_id_seq'::regclass);


--
-- Name: part_requests request_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_requests ALTER COLUMN request_id SET DEFAULT nextval('public.part_requests_request_id_seq'::regclass);


--
-- Name: parts part_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts ALTER COLUMN part_id SET DEFAULT nextval('public.parts_part_id_seq'::regclass);


--
-- Name: permission_audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_audit_logs ALTER COLUMN id SET DEFAULT nextval('public.permission_audit_logs_id_seq'::regclass);


--
-- Name: permission_sections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_sections ALTER COLUMN id SET DEFAULT nextval('public.permission_sections_id_seq'::regclass);


--
-- Name: photos photo_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos ALTER COLUMN photo_id SET DEFAULT nextval('public.photos_photo_id_seq'::regclass);


--
-- Name: procurement_requests request_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_requests ALTER COLUMN request_id SET DEFAULT nextval('public.procurement_requests_request_id_seq'::regclass);


--
-- Name: qc_photos photo_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_photos ALTER COLUMN photo_id SET DEFAULT nextval('public.qc_photos_photo_id_seq'::regclass);


--
-- Name: qc_results qc_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_results ALTER COLUMN qc_id SET DEFAULT nextval('public.qc_results_qc_id_seq'::regclass);


--
-- Name: rent_devices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rent_devices ALTER COLUMN id SET DEFAULT nextval('public.rent_devices_id_seq'::regclass);


--
-- Name: repair_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_logs ALTER COLUMN id SET DEFAULT nextval('public.repair_logs_id_seq'::regclass);


--
-- Name: role_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions ALTER COLUMN id SET DEFAULT nextval('public.role_permissions_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: sales_order_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_lines ALTER COLUMN id SET DEFAULT nextval('public.sales_order_lines_id_seq'::regclass);


--
-- Name: sales_order_payments payment_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_payments ALTER COLUMN payment_id SET DEFAULT nextval('public.sales_order_payments_payment_id_seq'::regclass);


--
-- Name: sales_order_serials allocation_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_serials ALTER COLUMN allocation_id SET DEFAULT nextval('public.sales_order_serials_allocation_id_seq'::regclass);


--
-- Name: sales_quotations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotations ALTER COLUMN id SET DEFAULT nextval('public.sales_quotations_id_seq'::regclass);


--
-- Name: sm_courier_details id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_courier_details ALTER COLUMN id SET DEFAULT nextval('public.sm_courier_details_id_seq'::regclass);


--
-- Name: spare_parts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spare_parts ALTER COLUMN id SET DEFAULT nextval('public.spare_parts_id_seq'::regclass);


--
-- Name: stage_checklists checklist_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_checklists ALTER COLUMN checklist_id SET DEFAULT nextval('public.stage_checklists_checklist_id_seq'::regclass);


--
-- Name: stage_transition_rules rule_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_transition_rules ALTER COLUMN rule_id SET DEFAULT nextval('public.stage_transition_rules_rule_id_seq'::regclass);


--
-- Name: stages stage_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stages ALTER COLUMN stage_id SET DEFAULT nextval('public.stages_stage_id_seq'::regclass);


--
-- Name: support_issue_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_issue_categories ALTER COLUMN id SET DEFAULT nextval('public.support_issue_categories_id_seq'::regclass);


--
-- Name: support_replacement_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_replacement_orders ALTER COLUMN id SET DEFAULT nextval('public.support_replacement_orders_id_seq'::regclass);


--
-- Name: support_ticket_item_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_item_audit ALTER COLUMN id SET DEFAULT nextval('public.support_ticket_item_audit_id_seq'::regclass);


--
-- Name: support_ticket_item_comments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_item_comments ALTER COLUMN id SET DEFAULT nextval('public.support_ticket_item_comments_id_seq'::regclass);


--
-- Name: support_ticket_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_items ALTER COLUMN id SET DEFAULT nextval('public.support_ticket_items_id_seq'::regclass);


--
-- Name: support_tickets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets ALTER COLUMN id SET DEFAULT nextval('public.support_tickets_id_seq'::regclass);


--
-- Name: teams team_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams ALTER COLUMN team_id SET DEFAULT nextval('public.teams_team_id_seq'::regclass);


--
-- Name: ticket_checklist_progress id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_checklist_progress ALTER COLUMN id SET DEFAULT nextval('public.ticket_checklist_progress_id_seq'::regclass);


--
-- Name: ticket_parts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_parts ALTER COLUMN id SET DEFAULT nextval('public.ticket_parts_id_seq'::regclass);


--
-- Name: ticket_services service_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_services ALTER COLUMN service_id SET DEFAULT nextval('public.ticket_services_service_id_seq'::regclass);


--
-- Name: tickets ticket_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets ALTER COLUMN ticket_id SET DEFAULT nextval('public.tickets_ticket_id_seq'::regclass);


--
-- Name: ttspl_audit_log log_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ttspl_audit_log ALTER COLUMN log_id SET DEFAULT nextval('public.ttspl_audit_log_log_id_seq'::regclass);


--
-- Name: ttspl_config_history history_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ttspl_config_history ALTER COLUMN history_id SET DEFAULT nextval('public.ttspl_config_history_history_id_seq'::regclass);


--
-- Name: user_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions ALTER COLUMN id SET DEFAULT nextval('public.user_permissions_id_seq'::regclass);


--
-- Name: users user_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN user_id SET DEFAULT nextval('public.users_user_id_seq'::regclass);


--
-- Name: vendor_audit_logs log_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_audit_logs ALTER COLUMN log_id SET DEFAULT nextval('public.vendor_audit_logs_log_id_seq'::regclass);


--
-- Name: vendor_billing billing_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_billing ALTER COLUMN billing_id SET DEFAULT nextval('public.vendor_billing_billing_id_seq'::regclass);


--
-- Name: vendor_debit_notes debit_note_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_debit_notes ALTER COLUMN debit_note_id SET DEFAULT nextval('public.vendor_debit_notes_debit_note_id_seq'::regclass);


--
-- Name: vendor_goods_received_notes grn_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_goods_received_notes ALTER COLUMN grn_id SET DEFAULT nextval('public.vendor_goods_received_notes_grn_id_seq'::regclass);


--
-- Name: vendor_monthly_bills bill_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_monthly_bills ALTER COLUMN bill_id SET DEFAULT nextval('public.vendor_monthly_bills_bill_id_seq'::regclass);


--
-- Name: vendor_portal_sessions session_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_portal_sessions ALTER COLUMN session_id SET DEFAULT nextval('public.vendor_portal_sessions_session_id_seq'::regclass);


--
-- Name: vendor_product_details product_detail_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_product_details ALTER COLUMN product_detail_id SET DEFAULT nextval('public.vendor_product_details_product_detail_id_seq'::regclass);


--
-- Name: vendor_product_inventory id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_product_inventory ALTER COLUMN id SET DEFAULT nextval('public.vendor_product_inventory_id_seq'::regclass);


--
-- Name: vendor_purchase_orders po_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_purchase_orders ALTER COLUMN po_id SET DEFAULT nextval('public.vendor_purchase_orders_po_id_seq'::regclass);


--
-- Name: vendor_refresh_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_refresh_tokens ALTER COLUMN id SET DEFAULT nextval('public.vendor_refresh_tokens_id_seq'::regclass);


--
-- Name: vendor_replaced_products replaced_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_replaced_products ALTER COLUMN replaced_id SET DEFAULT nextval('public.vendor_replaced_products_replaced_id_seq'::regclass);


--
-- Name: vendor_serial_number_audit audit_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_serial_number_audit ALTER COLUMN audit_id SET DEFAULT nextval('public.vendor_serial_number_audit_audit_id_seq'::regclass);


--
-- Name: vendor_serial_numbers serial_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_serial_numbers ALTER COLUMN serial_id SET DEFAULT nextval('public.vendor_serial_numbers_serial_id_seq'::regclass);


--
-- Name: vendor_shops shop_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_shops ALTER COLUMN shop_id SET DEFAULT nextval('public.vendor_shops_shop_id_seq'::regclass);


--
-- Name: vendor_spare_parts_catalog part_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_spare_parts_catalog ALTER COLUMN part_id SET DEFAULT nextval('public.vendor_spare_parts_catalog_part_id_seq'::regclass);


--
-- Name: vendor_spare_parts_purchase_orders spo_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_spare_parts_purchase_orders ALTER COLUMN spo_id SET DEFAULT nextval('public.vendor_spare_parts_purchase_orders_spo_id_seq'::regclass);


--
-- Name: vendor_wallets wallet_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_wallets ALTER COLUMN wallet_id SET DEFAULT nextval('public.vendor_wallets_wallet_id_seq'::regclass);


--
-- Name: vendors vendor_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors ALTER COLUMN vendor_id SET DEFAULT nextval('public.vendors_vendor_id_seq'::regclass);


--
-- Name: work_logs log_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_logs ALTER COLUMN log_id SET DEFAULT nextval('public.work_logs_log_id_seq'::regclass);


--
-- Data for Name: activities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.activities (activity_id, ticket_id, stage_id, user_id, action, notes, metadata, created_at) FROM stdin;
1	2	2	6	stage_work	Ran full diagnosis checklist	\N	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: allocation_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.allocation_logs (id, vendor_id, vendor_name, serial_number, unique_id, action_taken, remarks, qc_status, in_ward, out_ward, extra, created_at, user_id, customer_id, customer_name, challan_id, product_id, model_name, old_serial_number, po_type, purchase_type, locking_period, added_date, failure_reason, checked_by, assigned_to, warranty_status, rental_status, extra_details, require_parts, file_path, log_type, updated_at) FROM stdin;
1	2	TechRent Supplies Pvt Ltd	SN-DELL-5430-002	TTSPL0008	qc_passed	\N	passed	\N	\N	{}	2026-06-14 11:57:00.158718+00	8	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	{}	\N	\N	qc	2026-06-14 11:57:00.158718+00
2	2	TechRent Supplies Pvt Ltd	SN-DELL-5430-004	TTSPL0010	qc_passed	\N	passed	\N	\N	{}	2026-06-14 11:57:00.158718+00	8	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	{}	\N	\N	qc	2026-06-14 11:57:00.158718+00
3	1	TechRent Supplies Pvt Ltd	SN-DELL-3510-004	TTSPL0004	qc_passed	\N	passed	\N	\N	{}	2026-06-14 11:57:00.158718+00	8	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	{}	\N	\N	qc	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: chip_level_repairs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.chip_level_repairs (repair_id, ticket_id, created_by, updated_by, status, issues, issue_notes, parts_required, parts_notes, resolved_checks, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: companies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.companies (company_id, code, legal_name, gstin, pan, address, state_code, hsn_code, logo_url, dc_prefix, invoice_prefix, active, created_at, updated_at, email, phone) FROM stdin;
1	rentfoxxy	TRUETECH SERVICES PRIVATE LIMITED	06AAHCT0310N1ZG	\N	429, 4th Floor, JMD Megapolis Building, Sohna Road, Gurgaon, Haryana - 06	06	84713000	assets/rentfoxxy-logo.png	DC-	INV-	t	2026-06-12 21:54:37.988812+00	2026-06-12 21:54:37.988812+00	accounts@truetechservices.in	\N
2	gorefurbo	TRUETECH SERVICES PRIVATE LIMITED	06AAHCT0310N1ZG	\N	429, 4th Floor, JMD Megapolis Building, Sohna Road, Gurgaon, Haryana - 06	06	84713000	assets/gorefurbo-logo.png	GDC-	GINV-	t	2026-06-12 21:54:37.988812+00	2026-06-12 21:54:37.988812+00	accounts@truetechservices.in	\N
\.


--
-- Data for Name: customer_addresses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.customer_addresses (customer_address_id, customer_id, concern_person, mobile_no, address, pincode, is_head_office, source_lead_address_id, address_type, created_at, updated_at) FROM stdin;
1	1	Amit Sharma	9876500001	B-204, DLF Cyber City, Phase 2, Gurugram	122002	t	\N	billing	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
2	2	Sunita Reddy	9876500002	401, Jubilee Hills, Road No. 36, Hyderabad	500033	t	\N	billing	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
3	3	Rohan Malhotra	9876500003	12, HSR Layout, Sector 7, Bengaluru	560102	t	\N	billing	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
4	4	Arjun Patel	9876500004	22, SG Highway, Ahmedabad	380015	t	\N	billing	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: customer_credit_notes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.customer_credit_notes (credit_note_id, credit_note_number, customer_id, invoice_id, reason, description, amount, quantity, unit_rate, from_date, to_date, ttspl_ids, status, applied_in_invoice_id, created_by, approved_by, created_at, updated_at) FROM stdin;
1	CN-0001	1	1	Mid-month return	TTSPL0007 returned for 10 days credit.	1500.00	1	4500.00	2025-05-21	2025-05-31	["TTSPL0007"]	approved	\N	13	13	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: customer_documents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.customer_documents (doc_id, customer_id, lead_id, doc_type, doc_label, file_path, file_name, file_size_bytes, uploaded_by, is_signed, notes, created_at) FROM stdin;
1	1	\N	gst_certificate	GST Certificate	uploads/kyc/gst_1.pdf	gst.pdf	\N	\N	f	KYC document	2026-06-14 11:57:00.158718+00
2	2	\N	gst_certificate	GST Certificate	uploads/kyc/gst_2.pdf	gst.pdf	\N	\N	f	KYC document	2026-06-14 11:57:00.158718+00
3	3	\N	gst_certificate	GST Certificate	uploads/kyc/gst_3.pdf	gst.pdf	\N	\N	f	KYC document	2026-06-14 11:57:00.158718+00
4	1	\N	pan_card	PAN Card	uploads/kyc/pan_1.pdf	pan.pdf	\N	\N	f	KYC document	2026-06-14 11:57:00.158718+00
5	2	\N	pan_card	PAN Card	uploads/kyc/pan_2.pdf	pan.pdf	\N	\N	f	KYC document	2026-06-14 11:57:00.158718+00
6	3	\N	pan_card	PAN Card	uploads/kyc/pan_3.pdf	pan.pdf	\N	\N	f	KYC document	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: customer_inventory; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.customer_inventory (id, customer_id, asset_kind, asset_bucket, delivery_challan_id, dc_number, delivery_date, erp_serial_id, serial_number, unique_serial_number, model_name, generation, screen_size, ram, storage, gpu, processor, quotation_type, rate, locking_period, delivery_status, delivery_type, courier_name, awb_number, sales_status, documents, erp_raw, synced_at, created_at, updated_at, passivated_at, passivated_reason, deprecated) FROM stdin;
\.


--
-- Data for Name: customer_invoices; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.customer_invoices (invoice_id, invoice_number, customer_id, invoice_month, invoice_year, invoice_date, from_date, to_date, line_items, subtotal, gst_percent, gst_amount, credit_note_adjustment, security_deposit, grand_total, status, irn, irn_generated_at, qr_code_url, signed_qr_code, eway_bill_number, eway_bill_valid_till, pdf_path, sent_at, sent_by, paid_at, payment_reference, notes, created_at, updated_at, entity_code) FROM stdin;
1	INV-0001	1	5	2025	2025-06-01	2025-05-01	2025-05-31	[{"brand": "Dell", "model": "Latitude 5430", "amount": 4500.00, "ttspl_id": "TTSPL0007", "monthly_rate": 4500}]	4500.00	18.00	810.00	0.00	0.00	5310.00	sent	\N	\N	\N	\N	\N	\N	\N	2026-06-04 11:57:00.158718+00	13	\N	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	rentfoxxy
2	INV-0002	1	6	2025	2026-06-14	2026-06-01	2026-06-30	[{"brand": "Dell", "model": "Latitude 5430", "amount": 4500.00, "ttspl_id": "TTSPL0007", "monthly_rate": 4500}]	4500.00	18.00	810.00	0.00	0.00	5310.00	draft	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	rentfoxxy
\.


--
-- Data for Name: customer_portal_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.customer_portal_sessions (session_id, customer_id, token, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: customer_security_deposits; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.customer_security_deposits (deposit_id, customer_id, sales_order_number, amount, received_date, status, refund_amount, refund_date, refund_reference, notes, created_by, created_at, updated_at) FROM stdin;
1	1	SO-0001	7000.00	2026-06-09	held	0.00	\N	\N	1 month rental security deposit	13	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.customers (customer_id, name, email, phone, gst_no, type, details, address, created_at, updated_at, status, company_name, pan_number, company_type, company_size, industry, billing_address, billing_city, billing_state, billing_pincode, shipping_same, shipping_address, shipping_city, shipping_state, shipping_pincode, whatsapp_number, designation, source_lead_stage, onboarded_by, onboarded_at, portal_enabled, notes, kyc_verified, kyc_verified_by, kyc_verified_at, source_lead_id, portal_password_hash, portal_last_login, kyc_status, kyc_documents) FROM stdin;
1	Amit Sharma	amit@techcorp.com	9876500001	06AAHCT0310N1ZG	B2B	\N	B-204, DLF Cyber City, Phase 2, Gurugram	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	1	TechCorp Solutions Pvt Ltd	AAHCT0310N	Pvt Ltd	150	IT Services	B-204, DLF Cyber City, Phase 2	Gurugram	Haryana	122002	t	\N	\N	\N	\N	9876500001	IT Head	\N	\N	\N	t	\N	t	\N	\N	\N	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	\N	verified	[]
2	Sunita Reddy	sunita@reddyconsulting.com	9876500002	36AAFPR1234C1ZK	B2B	\N	401, Jubilee Hills, Road No. 36, Hyderabad	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	1	Reddy Consulting LLP	AAFPR1234C	LLP	45	Consulting	401, Jubilee Hills, Road No. 36	Hyderabad	Telangana	500033	t	\N	\N	\N	\N	9876500002	Director	\N	\N	\N	f	\N	t	\N	\N	\N	\N	\N	verified	[]
3	Rohan Malhotra	rohan@startuphub.io	9876500003	29AABCS5678D1Z2	B2B	\N	12, HSR Layout, Sector 7, Bengaluru	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	1	StartupHub Technologies	AABCS5678D	Pvt Ltd	28	SaaS	12, HSR Layout, Sector 7	Bengaluru	Karnataka	560102	t	\N	\N	\N	\N	9876500003	Founder	\N	\N	\N	f	\N	t	\N	\N	\N	\N	\N	verified	[]
4	Arjun Patel	arjun@patelent.com	9876500004	24AABCP9012E1Z9	B2B	\N	22, SG Highway, Ahmedabad	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	1	Patel Enterprises	AABCP9012E	Proprietorship	12	Trading	22, SG Highway	Ahmedabad	Gujarat	380015	t	\N	\N	\N	\N	9876500004	Owner	\N	\N	\N	f	\N	f	\N	\N	\N	\N	\N	pending	[]
\.


--
-- Data for Name: dc_qc_tickets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.dc_qc_tickets (id, dc_number, sales_order_number, ticket_id, ttspl_id, serial_id, status, created_at, updated_at) FROM stdin;
1	DC-0001	SO-0002	4	TTSPL0007	7	qc_passed	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: delivery_challan_lines; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.delivery_challan_lines (id, dc_number, sales_order_number, quotation_number, customer_id, customer_name, email, gst_number, supply_state, security_amount, shiping_charges, branch, customer_billing_address, customer_shipping_address, brand, model_name, quantity, main_qty, serial_number, ship_by, courier_name, awb_number, delivery_person_id, remarks, status, pdf_path, file_path, delivered_serial_numbers, rejected_serial_numbers, pickuped_serial_numbers, submitted_remark, submitted_name, submitted_person_id, submitted_person_type, created_by, created_at, updated_at, d_otp, d_otp_verified_at, d_customer_name, d_customer_email, d_customer_mobile, delivery_completed_at, date_and_time, latitude, longitude, old_rejected_serial_numbers, returned_serial_numbers, dispatch_mode, porter_booking_id, estimated_delivery, pre_dispatch_qc_ticket_id, pre_dispatch_qc_passed, irn, irn_generated_at, qr_code_url, eway_bill_number, eway_bill_valid_till, invoice_sent_at, invoice_sent_by, delivered_at, delivered_by, delivery_location, delivery_otp, delivery_otp_sent_at, pod_image_url, rejection_reason, entity_code) FROM stdin;
2	GDC-0001	GSO-0001	\N	2	Sunita Reddy	sunita@reddyconsulting.com	36AAFPR1234C1ZK	telangana	0.00	0.00	gorefurbo	{"city": "Hyderabad", "name": "Sunita Reddy", "state": "Telangana", "address": "401, Jubilee Hills", "pincode": "500033"}	{"city": "Hyderabad", "name": "Sunita Reddy", "state": "Telangana", "address": "401, Jubilee Hills", "pincode": "500033"}	Dell	Latitude 5430	1	1	["TTSPL0009"]	by_courier	Delhivery	DL987654321	\N	\N	delivered	\N	\N	["TTSPL0009"]	\N	\N	\N	\N	\N	\N	12	2026-06-08 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	\N	\N	\N	2026-06-10 11:57:00.158718+00	\N	\N	\N	\N	\N	courier	\N	\N	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	gorefurbo
3	DC-0002	SO-0003	\N	3	Rohan Malhotra	rohan@startuphub.io	29AABCS5678D1Z2	karnataka	0.00	0.00	rentfoxxy	{"city": "Bengaluru", "name": "Rohan Malhotra", "state": "Karnataka", "address": "12, HSR Layout", "pincode": "560102"}	{"city": "Bengaluru", "name": "Rohan Malhotra", "state": "Karnataka", "address": "12, HSR Layout", "pincode": "560102"}	Dell	Latitude 3510	1	1	["TTSPL0006"]	by_hand	\N	\N	12	\N	delivered	\N	\N	["TTSPL0006"]	\N	\N	\N	\N	\N	\N	12	2026-06-11 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	482910	2026-06-12 11:57:00.158718+00	\N	\N	\N	2026-06-12 11:57:00.158718+00	\N	\N	\N	\N	\N	inhouse	\N	\N	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	rentfoxxy
1	DC-0001	SO-0002	\N	1	Amit Sharma	amit@techcorp.com	06AAHCT0310N1ZG	haryana	0.00	0.00	rentfoxxy	{"city": "Gurugram", "name": "Amit Sharma", "state": "Haryana", "address": "B-204, DLF Cyber City", "pincode": "122002"}	{"city": "Gurugram", "name": "Amit Sharma", "state": "Haryana", "address": "B-204, DLF Cyber City", "pincode": "122002"}	Dell	Latitude 5430	1	1	["TTSPL0007"]	by_courier	BlueDart	BD123456789	\N	\N	delivered	\N	\N	\N	\N	\N	\N	\N	\N	\N	12	2026-06-13 11:57:00.158718+00	2026-06-14 14:42:07.44842+00	\N	\N	\N	\N	\N	2026-06-14 14:42:07.44842+00	\N	\N	\N	\N	\N	courier	\N	\N	\N	t	\N	\N	\N	\N	\N	\N	\N	2026-06-14 14:42:07.44842+00	1	\N	\N	\N	\N	\N	rentfoxxy
\.


--
-- Data for Name: delivery_technicians; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.delivery_technicians (technician_id, user_id, first_name, last_name, phone, email, is_active, created_at, updated_at, country_code, address, identity_type, identity_number, identity_image, image, password_hash) FROM stdin;
1	12	Amit	Kaur	9900000012	dispatch@rentfoxxy.com	t	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	91	\N	\N	\N	[]	\N	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K
\.


--
-- Data for Name: demo_agreements; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.demo_agreements (demo_id, sales_order_number, dc_number, customer_id, serial_id, ttspl_id, delivered_at, decision_due_at, decision, decided_at, decided_by, rent_start_date, pickup_ticket_id, notes, created_at, updated_at) FROM stdin;
1	SO-0003	DC-0002	3	6	TTSPL0006	2026-06-12 11:57:00.158718+00	2026-06-19 11:57:00.158718+00	pending	\N	\N	\N	\N	7-day demo; keep/return decision pending.	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: diagnosis_images; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.diagnosis_images (image_id, diagnosis_id, section_name, image_path, uploaded_at) FROM stdin;
\.


--
-- Data for Name: diagnosis_parts_required; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.diagnosis_parts_required (id, diagnosis_id, ticket_id, part_name, part_category, quantity, is_available, inventory_part_id, status, attached_by, attached_at, created_at) FROM stdin;
\.


--
-- Data for Name: diagnosis_results; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.diagnosis_results (diagnosis_id, ticket_id, diagnosed_by, diagnosed_at, power_on, power_button_working, boots_successfully, bios_accessible, bios_password_lock, display_on, brightness_control, no_flickering, no_lines_spots, webcam_working, all_keys_working, touchpad_working, left_click_working, right_click_working, battery_detected, battery_charging, charging_port_tight, battery_swollen, storage_detected, smart_status_ok, no_bad_sectors, ram_detected, correct_capacity, slot_1_working, slot_2_working, wifi_detected, wifi_connecting, bluetooth_working, usb_ports, type_c, hdmi, audio_jack, power_port, fan_spinning, no_abnormal_noise, heating_normal, no_short, no_rust_liquid, no_ic_heating, bios_unlocked, hdd_unlocked, no_mdm_computrace, power_issue_flag, display_replacement_required, keyboard_replacement_required, battery_replacement_required, storage_replacement_required, ram_slot_fault, network_card_check, port_repair_required, cleaning_paste_required, chip_level_repair_required, security_hold, total_failures, next_team, remarks, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: einvoice_records; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.einvoice_records (record_id, dc_number, invoice_id, customer_id, invoice_number, irn, ack_number, ack_date, signed_invoice, signed_qr_code, qr_code_image_url, status, cancelled_at, cancel_reason, zoho_response, generated_by, created_at) FROM stdin;
\.


--
-- Data for Name: email_queue; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.email_queue (email_id, to_email, subject, body_text, body_html, dedupe_key, status, attempts, max_attempts, scheduled_at, sent_at, last_error, created_at) FROM stdin;
\.


--
-- Data for Name: eway_bill_records; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eway_bill_records (record_id, dc_number, ewb_number, ewb_date, valid_upto, transporter_id, transporter_name, vehicle_number, mode_of_transport, distance_km, status, zoho_response, generated_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: existing_customer; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.existing_customer (customer_id, customer_name, contact_person_name, contact_person_number, customer_number, email, billing_address, shipping_address, erp_raw, synced_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: inventory; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inventory (inventory_id, stock_type, device_type, machine_number, serial_number, brand, model, processor, ram, storage, grade, status, stage, created_at, updated_at, generation, gpu, screen_size) FROM stdin;
1	Ready	Laptop	TTSPL0004	SN-DELL-3510-004	Dell	Latitude 3510	Intel Core i5	8 GB	256 GB SSD	A	In Stock	Inventory	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	10th Gen	Integrated	15.6"
2	Ready	Laptop	TTSPL0005	SN-DELL-3510-005	Dell	Latitude 3510	Intel Core i5	8 GB	256 GB SSD	A	In Stock	Inventory	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	10th Gen	Integrated	15.6"
3	Ready	Laptop	TTSPL0006	SN-DELL-3510-006	Dell	Latitude 3510	Intel Core i5	8 GB	256 GB SSD	A	In Stock	Inventory	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	10th Gen	Integrated	15.6"
4	Ready	Laptop	TTSPL0007	SN-DELL-5430-001	Dell	Latitude 5430	Intel Core i5	16 GB	512 GB SSD	A	In Stock	Inventory	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	12th Gen	Integrated	14"
5	Ready	Laptop	TTSPL0008	SN-DELL-5430-002	Dell	Latitude 5430	Intel Core i5	16 GB	512 GB SSD	A	In Stock	Inventory	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	12th Gen	Integrated	14"
6	Ready	Laptop	TTSPL0009	SN-DELL-5430-003	Dell	Latitude 5430	Intel Core i5	16 GB	512 GB SSD	A	In Stock	Inventory	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	12th Gen	Integrated	14"
7	Ready	Laptop	TTSPL0010	SN-DELL-5430-004	Dell	Latitude 5430	Intel Core i5	16 GB	512 GB SSD	A	In Stock	Inventory	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	12th Gen	Integrated	14"
\.


--
-- Data for Name: inventory_status_transitions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inventory_status_transitions (transition_id, serial_id, ttspl_id, from_status, to_status, reason, dc_number, customer_id, entity_code, actor_user_id, created_at) FROM stdin;
1	4	TTSPL0004	in_stock	reserved	SO attach SO-0001	\N	1	rentfoxxy	11	2026-06-14 11:57:00.158718+00
2	5	TTSPL0005	in_stock	reserved	SO attach SO-0001	\N	1	rentfoxxy	11	2026-06-14 11:57:00.158718+00
3	7	TTSPL0007	in_stock	in_transit	DC-0001 dispatch	DC-0001	1	rentfoxxy	12	2026-06-14 11:57:00.158718+00
4	9	TTSPL0009	in_stock	sold	GDC-0001 sale delivered	GDC-0001	2	gorefurbo	12	2026-06-14 11:57:00.158718+00
5	6	TTSPL0006	in_stock	on_demo	DC-0002 demo delivered	DC-0002	3	rentfoxxy	12	2026-06-14 11:57:00.158718+00
6	7	TTSPL0007	in_transit	rented	Delivered on DC-0001	DC-0001	1	rentfoxxy	1	2026-06-14 14:42:07.44842+00
\.


--
-- Data for Name: inward_outward; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inward_outward (id, serial_number, unique_number, product_type, transaction_type, meta, created_at) FROM stdin;
\.


--
-- Data for Name: laptop_catalog; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.laptop_catalog (catalog_id, brand, model, processor, generation, ram, storage, device_type, active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: lead_activities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lead_activities (activity_id, lead_id, user_id, action, status_from, status_to, notes, created_at, stage_from, stage_to) FROM stdin;
1	1	4	status_changed	\N	Hot	Lead contacted via email; agreement shared	2026-06-14 11:57:00.158718+00	\N	\N
\.


--
-- Data for Name: lead_addresses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lead_addresses (address_id, lead_id, concern_person, mobile_no, address, pincode, address_type, created_by, created_at) FROM stdin;
1	1	Vikash Gupta	9811100001	Electronic City Phase 1, Bengaluru	560100	billing	4	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: lead_assignments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lead_assignments (assignment_id, lead_id, assigned_to, assigned_by, assigned_at, batch_id) FROM stdin;
\.


--
-- Data for Name: lead_auto_assign_config; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lead_auto_assign_config (id, user_ids, round_robin_index, updated_at, updated_by) FROM stdin;
\.


--
-- Data for Name: lead_company_research; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lead_company_research (research_id, lead_id, cin, entity_type, roc, revenue, employees, gst, address, city, state, raw_response, researched_at, industry, pincode) FROM stdin;
1	1	L72200KA1981PLC013115	Public Ltd	\N	₹1.46L Cr	300000+	29AAACI1234F1Z0	\N	Bengaluru	Karnataka	\N	2026-06-14 11:57:00.158718+00	IT Services	\N
\.


--
-- Data for Name: lead_followup_notifications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lead_followup_notifications (notification_id, lead_id, follow_up_at, recipient_email, channel, notified_at) FROM stdin;
\.


--
-- Data for Name: lead_import_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lead_import_logs (import_id, imported_by, total_rows, imported, duplicates, errors, error_details, created_at) FROM stdin;
\.


--
-- Data for Name: lead_orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lead_orders (lead_order_id, lead_id, order_status, amount, details, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: lead_remarks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lead_remarks (remark_id, lead_id, user_id, note, created_at) FROM stdin;
1	1	4	Decision maker confirmed budget. Follow up tomorrow.	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: leads; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.leads (lead_id, name, company_name, email, phone, city, source, status, assigned_user_id, assigned_by, assigned_at, follow_up_date, is_duplicate, duplicate_of, rejection_reason, research_status, research_requested_at, created_at, updated_at, lead_stage, quotation_accept_token, quotation_accepted_at, quotation_last_sent_at, quotation_last_estimate_no, quotation_last_to_email, whatsapp_number, designation, quantity_required, monthly_budget, rental_duration, use_case, company_type, company_size, industry, annual_revenue, pan_number, gst_number, state, pincode, billing_address, shipping_same_as_billing, shipping_address, follow_up_time, converted_at, converted_by, customer_id, inquiry_type, last_activity_at, company_brand, brand, processor, generation, ram, storage, personal_remarks) FROM stdin;
1	Vikash Gupta	InfoSys India Ltd	vikash.gupta@infosys.com	9811100001	Bengaluru	Email	Hot	4	3	2026-06-09 11:57:00.158718+00	2026-06-15 00:00:00+00	f	\N	\N	pending	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	Agreement Sent	\N	\N	\N	\N	\N	9811100001	\N	10	3500.00	12	Work From Office	Pvt Ltd	500	IT Services	\N	\N	29AAACI1234F1Z0	Karnataka	\N	\N	t	\N	\N	\N	\N	\N	rental	2026-06-14 11:57:00.158718+00	Infosys	Dell	Intel Core i5	10th Gen	8 GB	256 GB SSD	Ready to sign. Shared agreement.
2	Meera Joshi	Digital Minds Pvt Ltd	meera@digitalminds.com	9822200002	Mumbai	Reference	Deal	4	3	2026-05-25 11:57:00.158718+00	\N	f	\N	\N	pending	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	\N	\N	\N	\N	\N	\N	5	4000.00	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	\N	\N	2026-06-13 11:57:00.158718+00	\N	\N	rental	2026-06-13 11:57:00.158718+00	\N	HP	Intel Core i5	\N	8 GB	256 GB SSD	\N
3	Arjun Patel	Patel Enterprises	arjun.lead@patelent.com	9833300003	Ahmedabad	Cold Call	Warm	4	3	2026-06-06 11:57:00.158718+00	2026-06-14 00:00:00+00	f	\N	\N	pending	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	Price Negotiation	\N	\N	\N	\N	\N	\N	\N	3	3800.00	6	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	\N	\N	\N	\N	\N	rental	2026-06-11 11:57:00.158718+00	\N	Lenovo	Intel Core i5	\N	8 GB	512 GB SSD	Wants below 3500.
4	Kavitha Nair	Kerala Tech Hub	kavitha@keraltech.com	9844400004	Kochi	Website	Cold	4	3	2026-06-12 11:57:00.158718+00	2026-06-17 00:00:00+00	f	\N	\N	pending	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	In Follow Up	\N	\N	\N	\N	\N	\N	\N	2	3000.00	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	\N	\N	\N	\N	\N	rental	2026-06-12 11:57:00.158718+00	\N	\N	\N	\N	\N	\N	\N
5	Devendra Rao	Rao Industries	devendra@raoindustries.com	9855500005	Pune	LinkedIn	Warm	4	3	2026-05-30 11:57:00.158718+00	2026-06-11 00:00:00+00	f	\N	\N	pending	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	Price Agreed	\N	\N	\N	\N	\N	\N	\N	8	3200.00	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	\N	\N	\N	\N	\N	rental	2026-06-09 11:57:00.158718+00	\N	\N	\N	\N	\N	\N	Agreed on price. Legal review pending.
6	Farida Khan	Khan Brothers Trading	farida@khanbros.com	9866600006	Surat	IndiaMART	Pending	4	3	2026-06-13 11:57:00.158718+00	\N	f	\N	\N	pending	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	\N	\N	\N	\N	\N	\N	15	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	\N	\N	\N	\N	\N	sales	2026-06-13 11:57:00.158718+00	\N	Dell	Intel Core i5	10th Gen	8 GB	256 GB SSD	\N
7	Imran Shaikh	Coastal Demo Co	imran@coastaldemo.com	9877700007	Goa	Website	Demo	4	3	2026-06-10 11:57:00.158718+00	\N	f	\N	\N	pending	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	\N	\N	\N	\N	\N	\N	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	\N	\N	\N	\N	\N	rental	2026-06-13 11:57:00.158718+00	\N	Dell	\N	\N	\N	\N	\N
\.


--
-- Data for Name: order_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.order_items (item_id, order_id, brand, processor, ram, storage, quantity, preferred_model, status, inventory_id, unit_price, gst_percent, gst_amount, total_with_gst, created_at, qc_passed, is_wfh, shipping_charge, estimate_id, destination_pincode, tracking_status, item_tracker_id, item_courier_partner, item_dispatch_date, item_estimated_delivery, delivered_at, proposed_delivery_date, qc_sales_checklist, qc_sales_passed_at) FROM stdin;
\.


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.orders (order_id, customer_id, lead_type, order_type, status, owner_user_id, lockin_period_days, security_amount, is_wfh, shipping_charge, shipping_gst_amount, subtotal_amount, items_gst_amount, grand_total_amount, invoice_number, invoice_generated_at, eway_bill_number, eway_bill_generated_at, delivery_date, shipping_address, dispatch_date, tracker_id, courier_partner, dispatched_at, estimated_delivery, qc_received_at, qc_completed_at, created_at, updated_at, cancelled_at, cancelled_by) FROM stdin;
\.


--
-- Data for Name: part_requests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.part_requests (request_id, ticket_id, requested_by, part_name, description, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: parts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.parts (part_id, part_name, part_type, quantity, vendor, cost, location_code, created_at, min_threshold, description, category) FROM stdin;
1	RAM 8GB DDR4	RAM	25	Kingston Technology	850.00	Rack-A-01	2026-06-14 11:57:00.158718+00	5	8GB DDR4 2666MHz SODIMM	ram
2	RAM 16GB DDR4	RAM	12	Kingston Technology	1800.00	Rack-A-02	2026-06-14 11:57:00.158718+00	3	16GB DDR4 3200MHz SODIMM	ram
3	SSD 256GB SATA	Storage	20	WD/Samsung	1200.00	Rack-A-03	2026-06-14 11:57:00.158718+00	5	256GB SATA SSD	storage
4	SSD 512GB SATA	Storage	10	WD/Samsung	2200.00	Rack-A-04	2026-06-14 11:57:00.158718+00	3	512GB SATA SSD	storage
5	SSD 256GB NVMe	Storage	8	WD/Samsung	1500.00	Rack-A-05	2026-06-14 11:57:00.158718+00	3	256GB M.2 NVMe SSD	storage
6	Laptop Battery 6-cell	Battery	15	Generic Compatible	1100.00	Rack-B-01	2026-06-14 11:57:00.158718+00	5	6-cell replacement battery	battery
7	Laptop Battery 4-cell	Battery	10	Generic Compatible	800.00	Rack-B-02	2026-06-14 11:57:00.158718+00	3	4-cell replacement battery	battery
8	Keyboard Dell 15"	Keyboard	8	Dell Parts	650.00	Rack-B-03	2026-06-14 11:57:00.158718+00	2	Dell Latitude/Inspiron 15 keyboard	keyboard
9	Keyboard HP 14"	Keyboard	6	HP Parts	600.00	Rack-B-04	2026-06-14 11:57:00.158718+00	2	HP ProBook/EliteBook 14 keyboard	keyboard
10	Keyboard Lenovo 14"	Keyboard	6	Lenovo Parts	620.00	Rack-B-05	2026-06-14 11:57:00.158718+00	2	Lenovo ThinkPad/IdeaPad 14 keyboard	keyboard
11	Display 15.6" FHD	Display	4	BOE/AU Optronics	2800.00	Rack-C-01	2026-06-14 11:57:00.158718+00	2	15.6 inch FHD IPS display	display
12	Display 14" FHD	Display	3	BOE/AU Optronics	2600.00	Rack-C-02	2026-06-14 11:57:00.158718+00	2	14 inch FHD IPS display	display
13	Thermal Paste	Cooling	50	Arctic	80.00	Shelf-1	2026-06-14 11:57:00.158718+00	10	Arctic MX-4 thermal compound 4g	cooling
14	Cooling Fan Dell	Cooling	5	Dell Parts	450.00	Rack-D-01	2026-06-14 11:57:00.158718+00	2	Dell CPU cooling fan	cooling
15	DC Jack 65W	Power	10	Generic	120.00	Shelf-2	2026-06-14 11:57:00.158718+00	3	DC power jack connector	power
16	Charger 65W Dell	Power	6	Dell OEM	850.00	Shelf-3	2026-06-14 11:57:00.158718+00	2	Dell 65W charger	power
17	Hinge Kit Left-Right	Body	8	Generic Compatible	350.00	Rack-E-01	2026-06-14 11:57:00.158718+00	2	Laptop lid hinge pair	body
18	Bottom Panel Dell	Body	4	Dell Parts	420.00	Rack-E-02	2026-06-14 11:57:00.158718+00	2	Dell Latitude base panel	body
19	USB Port Module	General	10	Generic	180.00	Shelf-4	2026-06-14 11:57:00.158718+00	3	USB 3.0 port module	general
20	WiFi Card Intel	General	8	Intel	550.00	Shelf-5	2026-06-14 11:57:00.158718+00	2	Intel WiFi 6 AX201 M.2 card	general
\.


--
-- Data for Name: permission_audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.permission_audit_logs (id, actor_user_id, target_type, target_id, action, payload, created_at) FROM stdin;
\.


--
-- Data for Name: permission_sections; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.permission_sections (id, section, description, sort_order, created_at) FROM stdin;
5	catalogue	Product catalogue	50	2026-06-11 14:20:28.184433+00
6	orders	Orders	60	2026-06-11 14:20:28.184433+00
10	permissions	Roles and permissions	100	2026-06-11 14:20:28.184433+00
11	invoices	Invoices	110	2026-06-11 14:20:28.184433+00
27	inventory_management	Inventory Management	160	2026-06-11 14:20:28.737665+00
7	dispatch	Dispatch	170	2026-06-11 14:20:28.184433+00
42	technicians_bucket_list	Technicians bucket list	50	2026-06-11 14:20:33.995238+00
30	customer_inventory	Customer Inventory	190	2026-06-11 14:20:28.737665+00
897	analytics_dashboard	Analytics Dashboard	11	2026-06-11 22:58:39.705514+00
956	lead_follow_ups	Follow-ups	41	2026-06-12 08:41:51.15297+00
173	lead_conversion	Lead Conversion	45	2026-06-11 17:40:40.592348+00
174	customer_documents	Customer Documents	85	2026-06-11 17:40:40.592348+00
41	delivery_register_management	Delivery Register	175	2026-06-11 14:20:32.640469+00
31	teams	Teams	200	2026-06-11 14:20:28.737665+00
32	roles	Roles	210	2026-06-11 14:20:28.737665+00
33	role_permissions	Role Permissions	220	2026-06-11 14:20:28.737665+00
123	floor_pipeline	Floor Pipeline	25	2026-06-11 17:16:47.4941+00
124	floor_tickets	Floor Tickets	26	2026-06-11 17:16:47.4941+00
34	user_permissions	User Permissions	230	2026-06-11 14:20:28.737665+00
125	chip_level_repair	Chip Level Repair	27	2026-06-11 17:16:47.4941+00
126	parts_inventory	Parts Inventory	28	2026-06-11 17:16:47.4941+00
469	security_deposits	Security Deposits	204	2026-06-11 21:17:47.998082+00
470	billing_dashboard	Billing Dashboard & Reports	205	2026-06-11 21:17:47.998082+00
127	ttspl_history	TTSPL History	29	2026-06-11 17:16:47.4941+00
39	operation_management	Operation Management	44	2026-06-11 14:20:29.857466+00
29	support_tickets	Support Ticket Management	300	2026-06-11 14:20:28.737665+00
589	support_settings	Support Module Settings	301	2026-06-11 22:11:15.910377+00
297	sales_pipeline	Sales Pipeline (Quotations, SOs, DCs)	55	2026-06-11 19:30:41.740308+00
298	payment_records	Payment Recording	56	2026-06-11 19:30:41.740308+00
299	einvoice_ewb	E-Invoice and E-Way Bill	57	2026-06-11 19:30:41.740308+00
300	dispatch_ops	Dispatch Operations	175	2026-06-11 19:30:41.740308+00
12	dashboard	Dashboard	10	2026-06-11 14:20:28.737665+00
2	inventory	Inventory	20	2026-06-11 14:20:28.184433+00
1	tickets	Tickets	30	2026-06-11 14:20:28.184433+00
15	leads	Leads	40	2026-06-11 14:20:28.737665+00
16	sales_orders	Sales Orders	50	2026-06-11 14:20:28.737665+00
975	reports_access	Reports Access	402	2026-06-12 08:41:51.15297+00
898	reports_export	Export Reports	403	2026-06-11 22:58:39.705514+00
1237	customer_assets	Customer Assets (held inventory)	86	2026-06-12 21:54:37.988812+00
9	users	User Management	350	2026-06-11 14:20:28.184433+00
40	customer_management	Customer management (ERP)	49	2026-06-11 14:20:30.959075+00
35	sales_quotations	Sales quotations (EST)	45	2026-06-11 14:20:29.301392+00
1238	kyc_management	Customer KYC	87	2026-06-12 21:54:37.988812+00
1239	demo_management	Demo Agreements	56	2026-06-12 21:54:37.988812+00
1240	company_settings	Company / Entity Settings	360	2026-06-12 21:54:37.988812+00
36	sales_orders_doc	Sales order documents (SO)	46	2026-06-11 14:20:29.301392+00
37	delivery_challans	Delivery challans (DC)	47	2026-06-11 14:20:29.301392+00
38	return_dc	Return delivery challans	48	2026-06-11 14:20:29.301392+00
465	customer_billing	Customer Billing & Invoices	200	2026-06-11 21:17:47.998082+00
466	vendor_billing_mgmt	Vendor Billing Management	201	2026-06-11 21:17:47.998082+00
467	credit_notes	Customer Credit Notes	202	2026-06-11 21:17:47.998082+00
468	debit_notes	Vendor Debit Notes	203	2026-06-11 21:17:47.998082+00
17	follow_ups	Follow Ups	60	2026-06-11 14:20:28.737665+00
18	lead_orders	Lead Orders	70	2026-06-11 14:20:28.737665+00
3	customers	Customers	80	2026-06-11 14:20:28.184433+00
20	manager_dashboard	Manager Dashboard	90	2026-06-11 14:20:28.737665+00
4	reports	Reports	100	2026-06-11 14:20:28.184433+00
22	parts	Parts	110	2026-06-11 14:20:28.737665+00
8	procurement	Procurement	120	2026-06-11 14:20:28.184433+00
24	vendor_management	Vendor Management	130	2026-06-11 14:20:28.737665+00
25	warehouse	Warehouse	140	2026-06-11 14:20:28.737665+00
26	qc_management	QC Management	150	2026-06-11 14:20:28.737665+00
\.


--
-- Data for Name: photos; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.photos (photo_id, ticket_id, stage_id, photo_url, photo_type, uploaded_by, uploaded_at) FROM stdin;
\.


--
-- Data for Name: procurement_requests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.procurement_requests (request_id, order_item_id, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: qc_photos; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qc_photos (photo_id, qc_id, photo_path, uploaded_at) FROM stdin;
\.


--
-- Data for Name: qc_results; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qc_results (qc_id, ticket_id, qc_stage, processor, generation, storage_type, ram_size, checklist_data, parts_replaced, replaced_parts, qc_result, failure_reasons, remarks, final_grade, grade_notes, tested_by, checked_by, qc_date, dispatch_date, is_locked, created_at, submitted_at) FROM stdin;
1	2	QC1	Intel Core i5	10th Gen	SSD	8 GB	{"battery": true, "display": true, "keyboard": true, "power_on": true}	f	\N	pass	\N	\N	A	\N	8	\N	2026-06-14	\N	f	2026-06-14 11:57:00.158718	\N
\.


--
-- Data for Name: qc_round_robin_state; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qc_round_robin_state (team_id, last_assigned_user_id, updated_at) FROM stdin;
9	\N	2026-06-14 11:57:00.158718+00
10	\N	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: rent_devices; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.rent_devices (id, serial_id, po_id, dc_number, serial_number, unique_number, product_id, rent_start_date, rent_end_date, rent_amount, month_rent, rent_with_gst, total_amount, vendor_id, type, status, customer_id, rent_stop_date, rent_start_date_again, created_at, updated_at) FROM stdin;
1	7	\N	DC-0001	SN-DELL-5430-001	TTSPL0007	\N	2026-06-13	\N	4500.00	4500.00	\N	\N	2	rental	active	1	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: repair_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.repair_logs (id, serial_number_id, serial_number, unique_number, new_serial_number, new_unique_number, repair_start_date, repair_end_date, type, remarks, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.role_permissions (id, role, section, can_view, can_create, can_edit, can_delete) FROM stdin;
1	technician	tickets	t	t	t	f
2	technician	inventory	t	f	f	f
3	technician	customers	t	f	f	f
4	vendor	catalogue	t	t	t	t
5	vendor	orders	t	f	f	f
6	customer	tickets	t	t	f	f
7	customer	invoices	t	f	f	f
5629	admin	customer_assets	t	f	f	f
5630	manager	customer_assets	t	f	f	f
5631	sales	customer_assets	t	f	f	f
5632	support_lead	customer_assets	t	f	f	f
5633	support_tech	customer_assets	t	f	f	f
5634	accounts	customer_assets	t	f	f	f
5635	admin	kyc_management	t	t	t	f
5636	manager	kyc_management	t	t	t	f
5637	sales	kyc_management	t	t	t	f
19	vendor	sales_orders	t	f	f	f
5638	admin	demo_management	t	t	t	f
21	vendor	lead_orders	t	f	f	f
5639	manager	demo_management	t	t	t	f
23	vendor	vendor_management	t	t	t	t
33	admin	dashboard	t	t	t	t
34	admin	inventory	t	t	t	t
35	admin	tickets	t	t	t	t
36	admin	leads	t	t	t	t
138	admin	sales_quotations	t	t	t	t
56	manager	dashboard	t	f	f	f
57	manager	inventory	t	t	t	t
58	manager	tickets	t	t	t	t
59	manager	leads	t	t	t	t
60	manager	sales_orders	t	t	t	t
61	manager	follow_ups	t	t	t	t
62	manager	lead_orders	t	t	t	t
63	manager	customers	t	t	t	t
64	manager	manager_dashboard	t	f	f	f
65	manager	reports	t	f	f	f
66	manager	parts	t	t	t	t
67	manager	procurement	t	t	t	t
68	manager	vendor_management	t	t	t	t
69	manager	warehouse	t	t	t	t
70	manager	qc_management	t	t	t	t
71	manager	inventory_management	t	t	t	t
72	manager	dispatch	t	t	t	t
73	manager	support_tickets	t	t	t	t
74	manager	customer_inventory	t	t	t	t
75	manager	teams	t	t	t	f
76	sales	dashboard	t	f	f	f
77	sales	leads	t	t	t	f
78	sales	sales_orders	t	t	t	f
79	sales	follow_ups	t	t	t	f
80	sales	lead_orders	t	t	t	f
81	sales	customers	t	t	t	f
82	floor_manager	dashboard	t	f	f	f
83	floor_manager	inventory	t	t	t	f
84	floor_manager	tickets	t	t	t	f
85	floor_manager	reports	t	f	f	f
86	floor_manager	parts	t	t	t	f
87	floor_manager	qc_management	t	t	t	f
88	floor_manager	inventory_management	t	t	t	f
89	floor_manager	dispatch	t	t	t	f
90	floor_manager	customer_inventory	t	t	f	f
91	procurement	procurement	t	t	t	t
92	procurement	vendor_management	t	t	t	t
93	qc	qc_management	t	t	t	f
94	warehouse	warehouse	t	t	t	t
95	dispatch	dispatch	t	t	t	t
96	support_lead	support_tickets	t	t	t	t
97	support_lead	customer_inventory	t	t	t	f
98	support_tech	support_tickets	t	t	t	f
99	support_tech	customer_inventory	t	f	f	f
100	team_member	dashboard	t	f	f	f
101	team_member	tickets	t	t	t	f
102	team_lead	dashboard	t	f	f	f
103	team_lead	tickets	t	t	t	t
109	customer	customers	t	f	f	f
139	admin	sales_orders_doc	t	t	t	t
140	admin	delivery_challans	t	t	t	t
141	admin	return_dc	t	t	t	t
37	admin	sales_orders	t	t	t	t
38	admin	follow_ups	t	t	t	t
5640	sales	demo_management	t	t	t	f
39	admin	lead_orders	t	t	t	t
40	admin	customers	t	t	t	t
5641	accounts	demo_management	t	f	f	f
41	admin	manager_dashboard	t	t	t	t
5642	admin	company_settings	t	t	t	f
8	admin	users	t	t	t	t
9	admin	permissions	t	t	t	t
5643	manager	company_settings	t	f	f	f
3742	manager	analytics_dashboard	t	f	f	f
3744	manager	reports_export	t	t	f	f
3745	accounts	reports_export	t	t	f	f
3746	sales	analytics_dashboard	t	f	f	f
142	manager	sales_quotations	t	t	t	f
143	manager	sales_orders_doc	t	t	t	f
42	admin	reports	t	t	t	t
43	admin	parts	t	t	t	t
44	admin	procurement	t	t	t	t
45	admin	vendor_management	t	t	t	t
46	admin	warehouse	t	t	t	t
47	admin	qc_management	t	t	t	t
48	admin	inventory_management	t	t	t	t
49	admin	dispatch	t	t	t	t
50	admin	support_tickets	t	t	t	t
51	admin	customer_inventory	t	t	t	t
31	admin	teams	t	t	t	t
25	admin	roles	t	t	t	t
27	admin	role_permissions	t	t	t	t
29	admin	user_permissions	t	t	t	t
3741	admin	analytics_dashboard	t	t	t	t
3743	admin	reports_export	t	t	t	t
4119	admin	reports_access	t	t	t	t
4142	admin	lead_follow_ups	t	t	t	t
4155	manager	lead_follow_ups	t	t	t	f
4170	manager	chip_level_repair	t	f	t	f
4185	manager	einvoice_ewb	t	t	f	f
4188	manager	reports_access	t	f	f	f
4190	manager	users	t	t	t	f
4192	manager	roles	t	f	f	f
4193	manager	role_permissions	t	f	t	f
4194	manager	user_permissions	t	f	t	f
4197	sales	lead_follow_ups	t	t	t	f
4204	sales	inventory	t	f	f	f
4205	sales	inventory_management	t	f	f	f
4206	sales	ttspl_history	t	f	f	f
4208	sales	reports_access	t	f	f	f
4218	floor_manager	warehouse	t	f	t	f
4219	floor_manager	vendor_management	t	f	f	f
4220	floor_manager	reports_access	t	f	f	f
4221	floor_manager	support_tickets	t	f	f	f
144	manager	delivery_challans	t	t	t	f
145	manager	return_dc	t	f	f	f
146	sales	sales_quotations	t	t	t	f
147	sales	sales_orders_doc	t	t	t	f
148	sales	delivery_challans	t	t	f	f
149	sales	return_dc	t	f	f	f
154	manager	delivery_register_management	t	t	t	f
155	sales	delivery_register_management	t	f	t	f
157	manager	technicians_bucket_list	t	f	f	f
158	sales	technicians_bucket_list	t	f	f	f
4238	qc	ttspl_history	t	f	f	f
479	admin	floor_pipeline	t	t	t	t
484	admin	floor_tickets	t	t	t	t
489	admin	chip_level_repair	t	t	t	t
492	admin	parts_inventory	t	t	t	t
497	admin	ttspl_history	t	t	t	t
692	admin	lead_conversion	t	t	t	t
153	admin	delivery_register_management	t	t	t	t
156	admin	technicians_bucket_list	t	t	t	t
1207	admin	sales_pipeline	t	t	t	t
1212	admin	payment_records	t	t	t	t
1215	admin	einvoice_ewb	t	t	t	t
695	admin	customer_documents	t	t	t	t
1218	admin	dispatch_ops	t	t	t	t
4223	team_member	floor_pipeline	t	f	t	f
4224	team_member	floor_tickets	t	f	t	f
4225	team_member	chip_level_repair	t	f	t	f
4226	team_member	parts_inventory	t	f	f	f
4227	team_member	ttspl_history	t	f	f	f
4229	team_lead	floor_pipeline	t	t	t	f
4230	team_lead	floor_tickets	t	t	t	f
289	super_admin	technicians_bucket_list	t	t	t	t
1373	super_admin	dispatch_ops	t	t	t	t
480	manager	floor_pipeline	t	t	t	f
481	floor_manager	floor_pipeline	t	t	t	f
482	technician	floor_pipeline	t	f	t	f
483	qc	floor_pipeline	t	f	t	f
485	manager	floor_tickets	t	f	t	f
486	floor_manager	floor_tickets	t	t	t	f
487	technician	floor_tickets	t	f	t	f
488	qc	floor_tickets	t	f	t	f
490	floor_manager	chip_level_repair	t	t	t	f
491	technician	chip_level_repair	t	f	t	f
493	manager	parts_inventory	t	t	t	f
494	floor_manager	parts_inventory	t	t	t	f
495	technician	parts_inventory	t	f	f	f
496	warehouse	parts_inventory	t	t	t	f
498	manager	ttspl_history	t	f	f	f
499	floor_manager	ttspl_history	t	f	f	f
500	technician	ttspl_history	t	f	f	f
501	warehouse	ttspl_history	t	f	f	f
502	accounts	ttspl_history	t	f	f	f
662	super_admin	ttspl_history	t	t	t	t
693	manager	lead_conversion	t	t	t	f
694	sales	lead_conversion	t	t	f	f
696	manager	customer_documents	t	t	t	f
697	sales	customer_documents	t	t	f	f
698	accounts	customer_documents	t	f	f	f
4231	team_lead	chip_level_repair	t	t	t	f
4232	team_lead	parts_inventory	t	f	f	f
4233	team_lead	ttspl_history	t	f	f	f
4234	qc	dashboard	t	f	f	f
4239	qc	inventory_management	t	f	f	f
4240	procurement	dashboard	t	f	f	f
1208	manager	sales_pipeline	t	t	t	f
1209	sales	sales_pipeline	t	t	f	f
1210	warehouse	sales_pipeline	t	f	t	f
1211	dispatch	sales_pipeline	t	f	t	f
4243	procurement	inventory_management	t	f	f	f
4244	procurement	parts_inventory	t	t	t	f
1213	manager	payment_records	t	t	t	f
1214	accounts	payment_records	t	t	t	f
1216	accounts	einvoice_ewb	t	t	f	f
1217	dispatch	einvoice_ewb	t	f	f	f
1219	manager	dispatch_ops	t	f	t	f
1220	dispatch	dispatch_ops	t	f	t	f
1221	warehouse	dispatch_ops	t	f	t	f
4245	warehouse	dashboard	t	f	f	f
4247	warehouse	inventory	t	f	t	f
4248	warehouse	inventory_management	t	f	t	f
4250	warehouse	delivery_challans	t	f	t	f
4252	warehouse	vendor_management	t	f	f	f
4253	dispatch	dashboard	t	f	f	f
4256	dispatch	delivery_challans	t	f	t	f
4257	dispatch	delivery_register_management	t	f	t	f
4259	dispatch	customers	t	f	f	f
4260	accounts	dashboard	t	f	f	f
4268	accounts	reports_access	t	f	f	f
4270	accounts	customers	t	f	f	f
4271	accounts	delivery_challans	t	f	f	f
4274	support_lead	dashboard	t	f	f	f
1922	manager	customer_billing	t	t	t	f
1923	accounts	customer_billing	t	t	t	f
1924	sales	customer_billing	t	f	f	f
1926	manager	vendor_billing_mgmt	t	t	t	f
1927	accounts	vendor_billing_mgmt	t	t	t	f
1929	manager	credit_notes	t	t	t	f
1930	accounts	credit_notes	t	t	f	f
1932	manager	debit_notes	t	t	t	f
1933	accounts	debit_notes	t	t	f	f
1935	manager	security_deposits	t	t	t	f
1936	accounts	security_deposits	t	t	t	f
1938	manager	billing_dashboard	t	f	f	f
1939	accounts	billing_dashboard	t	f	f	f
13	super_admin	catalogue	t	t	t	t
14	super_admin	orders	t	t	t	t
2435	support	support_tickets	t	t	t	f
2436	sales	support_tickets	t	f	f	f
2437	accounts	support_tickets	t	f	f	f
2439	manager	support_settings	t	f	t	f
3983	admin	operation_management	t	t	t	t
3991	admin	catalogue	t	t	t	t
3998	admin	orders	t	t	t	t
4006	admin	invoices	t	t	t	t
1921	admin	customer_billing	t	t	t	t
1925	admin	vendor_billing_mgmt	t	t	t	t
1928	admin	credit_notes	t	t	t	t
1931	admin	debit_notes	t	t	t	t
1934	admin	security_deposits	t	t	t	t
1937	admin	billing_dashboard	t	t	t	t
2438	admin	support_settings	t	t	t	t
4276	support_lead	support_settings	t	f	t	f
4277	support_lead	customers	t	f	f	f
4279	support_lead	ttspl_history	t	f	f	f
4280	support_tech	dashboard	t	f	f	f
4282	support_tech	customers	t	f	f	f
17	super_admin	permissions	t	t	t	t
15	super_admin	invoices	t	t	t	t
3935	super_admin	analytics_dashboard	t	t	t	t
150	admin	customer_management	t	t	t	t
4084	super_admin	lead_follow_ups	t	t	t	t
843	super_admin	lead_conversion	t	t	t	t
151	manager	customer_management	t	t	t	t
152	sales	customer_management	t	t	t	f
844	super_admin	customer_documents	t	t	t	t
288	super_admin	delivery_register_management	t	t	t	t
658	super_admin	floor_pipeline	t	t	t	t
659	super_admin	floor_tickets	t	t	t	t
660	super_admin	chip_level_repair	t	t	t	t
661	super_admin	parts_inventory	t	t	t	t
2125	super_admin	customer_billing	t	t	t	t
2126	super_admin	vendor_billing_mgmt	t	t	t	t
2127	super_admin	credit_notes	t	t	t	t
2128	super_admin	debit_notes	t	t	t	t
2129	super_admin	security_deposits	t	t	t	t
2130	super_admin	billing_dashboard	t	t	t	t
2640	super_admin	support_settings	t	t	t	t
295	super_admin	operation_management	t	t	t	t
115	super_admin	dashboard	t	t	t	t
11	super_admin	inventory	t	t	t	t
10	super_admin	tickets	t	t	t	t
118	super_admin	leads	t	t	t	t
20	super_admin	sales_orders	t	t	t	t
120	super_admin	follow_ups	t	t	t	t
22	super_admin	lead_orders	t	t	t	t
12	super_admin	customers	t	t	t	t
123	super_admin	manager_dashboard	t	t	t	t
18	super_admin	reports	t	t	t	t
125	super_admin	parts	t	t	t	t
1371	super_admin	payment_records	t	t	t	t
130	super_admin	inventory_management	t	t	t	t
131	super_admin	dispatch	t	t	t	t
132	super_admin	support_tickets	t	t	t	t
133	super_admin	customer_inventory	t	t	t	t
32	super_admin	teams	t	t	t	t
26	super_admin	roles	t	t	t	t
28	super_admin	role_permissions	t	t	t	t
30	super_admin	user_permissions	t	t	t	t
294	super_admin	customer_management	t	t	t	t
290	super_admin	sales_quotations	t	t	t	t
291	super_admin	sales_orders_doc	t	t	t	t
292	super_admin	delivery_challans	t	t	t	t
293	super_admin	return_dc	t	t	t	t
4061	super_admin	reports_access	t	t	t	t
3936	super_admin	reports_export	t	t	t	t
16	super_admin	users	t	t	t	t
126	super_admin	procurement	t	t	t	t
24	super_admin	vendor_management	t	t	t	t
128	super_admin	warehouse	t	t	t	t
129	super_admin	qc_management	t	t	t	t
1370	super_admin	sales_pipeline	t	t	t	t
1372	super_admin	einvoice_ewb	t	t	t	t
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.roles (id, name, display_name, description, is_system_role, created_at, updated_at) FROM stdin;
3	technician	Technician	Field / repair technician	t	2026-06-11 14:20:28.184433+00	2026-06-11 14:20:28.184433+00
4	vendor	Vendor	External vendor partner	t	2026-06-11 14:20:28.184433+00	2026-06-11 14:20:28.184433+00
5	customer	Customer	Customer portal user	t	2026-06-11 14:20:28.184433+00	2026-06-11 14:20:28.184433+00
1	super_admin	Super Admin	Full unrestricted access	t	2026-06-11 14:20:28.184433+00	2026-06-11 14:20:28.184433+00
2	admin	Admin	Full CRM access	t	2026-06-11 14:20:28.184433+00	2026-06-11 14:20:28.184433+00
103	manager	Manager	Approvals, reports, team oversight	t	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
104	sales	Sales	Leads, quotations, sales orders	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
105	floor_manager	Floor Manager	Assign tickets, floor oversight	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
106	team_member	Technician (Floor)	Assigned tickets, parts requests	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
107	team_lead	Senior Technician	Team tickets, parts management	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
108	qc	QC Inspector	QC1/QC2 stages only	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
109	procurement	Procurement	Purchase orders, GRN, vendors	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
110	warehouse	Warehouse	GRN, inventory, DC attachment	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
111	dispatch	Dispatch	Delivery challans, dispatch	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
112	accounts	Accounts	Billing, invoices, finance	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
113	support_lead	Support Lead	All support tickets, team management	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
114	support_tech	Support Technician	Own assigned support tickets	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
\.


--
-- Data for Name: sales_order_lines; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sales_order_lines (id, sales_order_number, quotation_number, customer_id, customer_name, customer_email, customer_mobile, customer_shipping_address, customer_billing_address, gst_number, supply_state, security_amount, shiping_charges, quotation_type, branch, brand, model_name, processor, generation, ram, storage, gpu, screen_size, quantity, main_qty, rate, locking_period, battery_charger_warranty, technical_warranty, remark, status, token, pdf_path, created_by, created_at, updated_at, entity_code, security_type) FROM stdin;
1	SO-0001	EST-0001	1	Amit Sharma	amit@techcorp.com	9876500001	{"city": "Gurugram", "name": "Amit Sharma", "state": "Haryana", "address": "B-204, DLF Cyber City", "pincode": "122002"}	{"city": "Gurugram", "name": "Amit Sharma", "state": "Haryana", "address": "B-204, DLF Cyber City", "pincode": "122002", "gst_number": "06AAHCT0310N1ZG"}	06AAHCT0310N1ZG	haryana	7000.00	0.00	rental	rentfoxxy	Dell	Latitude 3510	Intel Core i5	10th Gen	8 GB	256 GB SSD	\N	\N	2	2	3500.00	12	\N	\N	\N	processing	\N	\N	4	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	rentfoxxy	one_month_rental
2	SO-0002	N/A	1	Amit Sharma	amit@techcorp.com	9876500001	{"city": "Gurugram", "name": "Amit Sharma", "state": "Haryana", "address": "B-204, DLF Cyber City", "pincode": "122002"}	{"city": "Gurugram", "name": "Amit Sharma", "state": "Haryana", "address": "B-204, DLF Cyber City", "pincode": "122002", "gst_number": "06AAHCT0310N1ZG"}	06AAHCT0310N1ZG	haryana	4500.00	0.00	rental	rentfoxxy	Dell	Latitude 5430	Intel Core i5	12th Gen	16 GB	512 GB SSD	\N	\N	1	1	4500.00	12	\N	\N	\N	processing	\N	\N	4	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	rentfoxxy	one_month_rental
3	GSO-0001	EST-0002	2	Sunita Reddy	sunita@reddyconsulting.com	9876500002	{"city": "Hyderabad", "name": "Sunita Reddy", "state": "Telangana", "address": "401, Jubilee Hills", "pincode": "500033"}	{"city": "Hyderabad", "name": "Sunita Reddy", "state": "Telangana", "address": "401, Jubilee Hills", "pincode": "500033", "gst_number": "36AAFPR1234C1ZK"}	36AAFPR1234C1ZK	telangana	0.00	500.00	sale	gorefurbo	Dell	Latitude 5430	Intel Core i5	12th Gen	16 GB	512 GB SSD	\N	\N	1	1	42000.00	\N	\N	\N	\N	completed	\N	\N	4	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	gorefurbo	none
4	SO-0003	EST-0003	3	Rohan Malhotra	rohan@startuphub.io	9876500003	{"city": "Bengaluru", "name": "Rohan Malhotra", "state": "Karnataka", "address": "12, HSR Layout", "pincode": "560102"}	{"city": "Bengaluru", "name": "Rohan Malhotra", "state": "Karnataka", "address": "12, HSR Layout", "pincode": "560102", "gst_number": "29AABCS5678D1Z2"}	29AABCS5678D1Z2	karnataka	0.00	0.00	demo	rentfoxxy	Dell	Latitude 3510	Intel Core i5	10th Gen	8 GB	256 GB SSD	\N	\N	1	1	0.00	\N	\N	\N	\N	processing	\N	\N	4	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	rentfoxxy	none
\.


--
-- Data for Name: sales_order_payments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sales_order_payments (payment_id, sales_order_number, customer_id, payment_type, amount, payment_date, payment_mode, reference_number, notes, recorded_by, created_at) FROM stdin;
1	SO-0001	1	advance	7000.00	2026-06-09	bank_transfer	HDFC-TXN-20250601-4521	Advance before dispatch	13	2026-06-14 11:57:00.158718+00
2	SO-0001	1	security_deposit	7000.00	2026-06-09	bank_transfer	HDFC-TXN-20250601-4522	1 month rental security	13	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: sales_order_serials; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sales_order_serials (allocation_id, sales_order_number, line_id, serial_id, ttspl_id, serial_number, qc_ticket_id, qc_status, status, dc_number, entity_code, created_by, created_at, updated_at) FROM stdin;
1	SO-0001	1	4	TTSPL0004	SN-DELL-3510-004	\N	passed	attached	\N	rentfoxxy	11	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
2	SO-0001	1	5	TTSPL0005	SN-DELL-3510-005	\N	passed	attached	\N	rentfoxxy	11	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
3	SO-0002	2	7	TTSPL0007	SN-DELL-5430-001	4	passed	dispatched	DC-0001	rentfoxxy	11	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
4	GSO-0001	3	9	TTSPL0009	SN-DELL-5430-003	\N	passed	dispatched	GDC-0001	gorefurbo	11	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
5	SO-0003	4	6	TTSPL0006	SN-DELL-3510-006	\N	passed	dispatched	DC-0002	rentfoxxy	11	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: sales_quotations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sales_quotations (id, quotation_number, customer_id, customer_name, customer_email, customer_mobile, customer_shipping_address, customer_billing_address, contact_person_name, contact_person_mobile, gst_number, supply_state, security_amount, shiping_charges, quotation_type, brand, model_name, processor, generation, ram, storage, gpu, screen_size, quantity, main_quantity, rate, locking_period, battery_charger_warranty, technical_warranty, remark, status, token, pdf_path, status_updated_by_id, status_updated_by_name, created_by, created_at, updated_at, source_lead_id, entity_code, security_type) FROM stdin;
2	EST-0002	2	Sunita Reddy	sunita@reddyconsulting.com	9876500002	{"city": "Hyderabad", "name": "Sunita Reddy", "state": "Telangana", "address": "401, Jubilee Hills", "pincode": "500033"}	{"city": "Hyderabad", "name": "Sunita Reddy", "state": "Telangana", "address": "401, Jubilee Hills", "pincode": "500033", "gst_number": "36AAFPR1234C1ZK"}	\N	\N	36AAFPR1234C1ZK	telangana	0.00	500.00	sale	Dell	Latitude 5430	Intel Core i5	12th Gen	16 GB	512 GB SSD	\N	\N	1	1	42000.00	\N	\N	\N	Refurbished sale unit.	approved	\N	\N	\N	\N	4	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	gorefurbo	none
3	EST-0003	3	Rohan Malhotra	rohan@startuphub.io	9876500003	{"city": "Bengaluru", "name": "Rohan Malhotra", "state": "Karnataka", "address": "12, HSR Layout", "pincode": "560102"}	{"city": "Bengaluru", "name": "Rohan Malhotra", "state": "Karnataka", "address": "12, HSR Layout", "pincode": "560102", "gst_number": "29AABCS5678D1Z2"}	\N	\N	29AABCS5678D1Z2	karnataka	0.00	0.00	demo	Dell	Latitude 3510	Intel Core i5	10th Gen	8 GB	256 GB SSD	\N	\N	1	1	0.00	\N	\N	\N	7-day free demo.	approved	\N	\N	\N	\N	4	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	rentfoxxy	none
1	EST-0001	1	Amit Sharma	amit@techcorp.com	9876500001	{"city": "Gurugram", "name": "Amit Sharma", "state": "Haryana", "address": "B-204, DLF Cyber City", "pincode": "122002"}	{"city": "Gurugram", "name": "Amit Sharma", "state": "Haryana", "address": "B-204, DLF Cyber City", "pincode": "122002", "gst_number": "06AAHCT0310N1ZG"}	\N	\N	06AAHCT0310N1ZG	haryana	7000.00	0.00	rental	Dell	Latitude 3510	Intel Core i5	10th Gen	8 GB	256 GB SSD	\N	\N	2	2	3500.00	\N	\N	\N	1 month rental as security.	approved	\N	uploads/sales-documents/EST-0001_1781438644852.pdf	\N	\N	4	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	rentfoxxy	one_month_rental
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.schema_migrations (name, applied_at) FROM stdin;
000_schema_migrations.sql	2026-06-11 14:20:07.485124+00
001_user_teams.sql	2026-06-11 14:20:08.034094+00
002_order_items_qc_passed.sql	2026-06-11 14:20:08.584292+00
003_stage_categories_ttspl_id.sql	2026-06-11 14:20:09.131136+00
004_add_qc_tables.sql	2026-06-11 14:20:09.681447+00
005_order_item_level_logistics.sql	2026-06-11 14:20:10.23653+00
006_inventory_erp_sync.sql	2026-06-11 14:20:10.786034+00
008_replace_repeat_with_callback.sql	2026-06-11 14:20:11.922156+00
009_lead_remarks.sql	2026-06-11 14:20:12.477852+00
010_add_order_teams.sql	2026-06-11 14:20:13.021997+00
011_add_proposed_delivery_date.sql	2026-06-11 14:20:13.570429+00
013_warehouse_team.sql	2026-06-11 14:20:14.11672+00
014_stage_categories_ttspl_id.sql	2026-06-11 14:20:14.662491+00
015_hardware_software_team.sql	2026-06-11 14:20:15.214888+00
017_apple_generation_laptop_catalog.sql	2026-06-11 14:20:16.040191+00
018_order_items_qc_sales_checklist.sql	2026-06-11 14:20:16.591452+00
019_lead_stage_demo.sql	2026-06-11 14:20:17.142193+00
020_order_type_normalize.sql	2026-06-11 14:20:17.686547+00
022_orders_qc_timing.sql	2026-06-11 14:20:18.510053+00
023_tickets_serial_repair_cycles.sql	2026-06-11 14:20:19.05981+00
024_existing_customer_inventory.sql	2026-06-11 14:20:19.611808+00
025_support_module.sql	2026-06-11 14:20:20.170897+00
026_support_redesign.sql	2026-06-11 14:20:20.722645+00
027_support_v2.sql	2026-06-11 14:20:21.275002+00
028_support_user_roles.sql	2026-06-11 14:20:21.826591+00
029_rbac_system.sql	2026-06-11 14:20:22.379263+00
029_support_v3.sql	2026-06-11 14:20:22.932821+00
030_lead_quotation_accept.sql	2026-06-11 14:20:23.478764+00
031_support_ticket_category.sql	2026-06-11 14:20:24.027196+00
032_vendor_management.sql	2026-06-11 14:20:24.595629+00
033_vendor_po_bills.sql	2026-06-11 14:20:25.146054+00
034_vendor_spo_bills_and_parts_catalog.sql	2026-06-11 14:20:25.695951+00
035_vendor_spare_grn_serial.sql	2026-06-11 14:20:26.251118+00
036_vendor_serial_ttspl_and_rental.sql	2026-06-11 14:20:26.799773+00
037_vendor_serial_inventory_meta.sql	2026-06-11 14:20:27.354569+00
038_inventory_management_laravel_views.sql	2026-06-11 14:20:27.910144+00
040_rbac_roles_module.sql	2026-06-11 14:20:28.461477+00
041_application_sections.sql	2026-06-11 14:20:29.026171+00
042_sales_management_module.sql	2026-06-11 14:20:29.5846+00
043_operation_management_extras.sql	2026-06-11 14:20:30.131746+00
044_quotation_demo_type.sql	2026-06-11 14:20:30.682154+00
045_customer_management_module.sql	2026-06-11 14:20:31.230824+00
046_qc_check_parity.sql	2026-06-11 14:20:31.793924+00
047_vendor_product_details.sql	2026-06-11 14:20:32.348675+00
048_delivery_register_management.sql	2026-06-11 14:20:33.170542+00
049_delivery_technicians_laravel_parity.sql	2026-06-11 14:20:33.720415+00
050_technicians_bucket_list.sql	2026-06-11 14:20:34.272639+00
051_grn_ticket_flow.sql	2026-06-11 14:20:34.823725+00
052_phase1_vendor_procurement.sql	2026-06-11 14:20:35.374552+00
053_vendor_billing_tables.sql	2026-06-11 14:20:35.930757+00
054_vendor_invoice_upload.sql	2026-06-11 14:20:36.481347+00
055_vendor_portal_sessions.sql	2026-06-11 14:20:37.02844+00
078_clean_and_reseed.sql	2026-06-14 11:57:00.158718+00
079_dc_status_in_transit.sql	2026-06-14 11:59:44.185069+00
\.


--
-- Data for Name: sm_courier_details; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_courier_details (id, courier_name, awb_number, dc_number, created_at) FROM stdin;
\.


--
-- Data for Name: sm_document_sequences; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_document_sequences (doc_type, last_value, prefix, updated_at) FROM stdin;
sales_order	4	SO-	2026-06-14 18:47:20.150963+00
return_dc	0	RDC	2026-06-11 14:20:29.301392+00
invoice_gorefurbo	0	GINV-	2026-06-12 21:54:37.988812+00
quotation	3	EST-	2026-06-14 07:55:10.461968+00
quote_rentfoxxy	2	EST-	2026-06-12 21:54:37.988812+00
quote_gorefurbo	1	GEST-	2026-06-12 21:54:37.988812+00
so_rentfoxxy	3	SO-	2026-06-12 21:54:37.988812+00
so_gorefurbo	1	GSO-	2026-06-12 21:54:37.988812+00
delivery_challan	2	DC-	2026-06-14 08:09:03.719317+00
dc_rentfoxxy	2	DC-	2026-06-12 21:54:37.988812+00
dc_gorefurbo	1	GDC-	2026-06-12 21:54:37.988812+00
customer_invoice	2	INV-	2026-06-11 21:17:47.998082+00
invoice_rentfoxxy	2	INV-	2026-06-12 21:54:37.988812+00
credit_note	1	CN-	2026-06-11 21:17:47.998082+00
vendor_bill	1	VB-	2026-06-11 14:20:35.65036+00
vendor_debit_note	1	DN-	2026-06-11 14:20:35.65036+00
support_ticket	2	TKT-	2026-06-12 08:16:37.067058+00
\.


--
-- Data for Name: spare_parts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.spare_parts (id, name, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: stage_checklists; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.stage_checklists (checklist_id, stage_id, checklist_items, created_at) FROM stdin;
\.


--
-- Data for Name: stage_transition_rules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.stage_transition_rules (rule_id, from_stage_name, to_stage_name, condition, is_backward, notes) FROM stdin;
1	Floor Manager	Diagnosis	\N	f	Auto on assign
2	Diagnosis	Assembly & Software	no_chip_no_body	f	Normal flow
3	Diagnosis	Chip Level Repair	chip_required	f	Chip issue found
4	Diagnosis	Body & Paint	body_required	f	Body issue only
5	Chip Level Repair	Assembly & Software	\N	f	After chip repair
6	Body & Paint	Assembly & Software	\N	f	After body work
7	Assembly & Software	Final Testing	\N	f	Normal flow
8	Final Testing	QC1	\N	f	Normal flow
9	QC1	QC2	qc1_passed	f	QC1 passed
10	QC1	Assembly & Software	qc1_failed	t	QC1 failed — back to tech
11	QC2	Inventory	qc2_passed	f	QC2 passed — inventory ready
12	QC2	QC1	qc2_failed	t	QC2 failed — back to QC1
\.


--
-- Data for Name: stages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.stages (stage_id, stage_name, stage_order, team_id, stage_category, description, created_at) FROM stdin;
1	Floor Manager	1	1	\N	Receive laptop and create initial ticket	2026-06-11 14:20:06.887554+00
3	Chip Level Repair	3	3	\N	Motherboard and chip-level repairs	2026-06-11 14:20:06.887554+00
4	Dismantle	4	4	\N	Parts tagging and removal	2026-06-11 14:20:06.887554+00
5	Procurement	5	5	\N	Source required parts	2026-06-11 14:20:06.887554+00
6	Body & Paint	6	6	\N	Body repair and paint work	2026-06-11 14:20:06.887554+00
11	Inventory	11	11	\N	Add to final inventory	2026-06-11 14:20:06.887554+00
9	QC1	9	9	QC Team	First quality check - 50+ points	2026-06-11 14:20:06.887554+00
10	QC2	10	10	QC Team	Second quality check - final verification	2026-06-11 14:20:06.887554+00
2	Diagnosis	2	14	Hardware & Software	Full hardware and cosmetic diagnosis	2026-06-11 14:20:06.887554+00
7	Assembly & Software	7	14	Hardware & Software	Repair, replacement, and software installation	2026-06-11 14:20:06.887554+00
8	Final Testing	8	14	Hardware & Software	Final system validation and defect resolution	2026-06-11 14:20:06.887554+00
\.


--
-- Data for Name: support_issue_categories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.support_issue_categories (id, name, active, sort_order, created_at) FROM stdin;
1	Hardware / performance	t	10	2026-06-11 14:20:19.885915+00
2	Display / keyboard / touchpad	t	20	2026-06-11 14:20:19.885915+00
3	Battery / charging	t	30	2026-06-11 14:20:19.885915+00
4	Software / OS	t	40	2026-06-11 14:20:19.885915+00
5	Network / Wi-Fi	t	50	2026-06-11 14:20:19.885915+00
6	Pickup / return logistics	t	60	2026-06-11 14:20:19.885915+00
7	Other	t	99	2026-06-11 14:20:19.885915+00
\.


--
-- Data for Name: support_replacement_orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.support_replacement_orders (id, ticket_id, item_id, source_item_id, old_customer_inventory_id, new_customer_inventory_id, old_machine_serial, new_machine_serial, status, created_by, notes, created_at, dispatched_at, delivered_at, inventory_updated_at, complaint_item_id, pickup_item_id, dispatch_method, courier_name, awb_number, delivery_otp_code, delivery_otp_verified_at, warehouse_otp_code, warehouse_otp_verified_at, flagged_at, approved_at, out_for_delivery_at, pickup_completed_at) FROM stdin;
\.


--
-- Data for Name: support_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.support_settings (key, value, updated_at) FROM stdin;
auto_close_enabled	true	2026-06-11 14:20:20.447384+00
overdue_threshold_hours	48	2026-06-11 14:20:20.447384+00
msr91_enabled	false	2026-06-11 14:20:20.447384+00
\.


--
-- Data for Name: support_ticket_item_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.support_ticket_item_audit (id, item_id, ticket_id, user_id, action, detail, created_at) FROM stdin;
1	1	1	14	created	{"note": "ticket opened"}	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: support_ticket_item_comments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.support_ticket_item_comments (id, item_id, user_id, author_role, body, created_at) FROM stdin;
1	1	15	support_tech	Called customer; scheduling technician visit.	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: support_ticket_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.support_ticket_items (id, ticket_id, customer_inventory_id, serial_number, unique_serial_number, brand, model, ram, storage, generation, item_type, issue_category_id, issue_category_label, remarks, assigned_to, status, otp_code, otp_verified_at, pod_image_path, work_done_at, loan_machine_serial, loan_delivered_at, pickup_scheduled_at, resolved_at, created_at, updated_at, visited_at, picked_up_at, replacement_flagged_by, replacement_flag_reason, replacement_approved_by, replacement_approved_at, source_item_id, current_step, outcome, outcome_set_by, outcome_set_at, pod_uploaded_at, warehouse_otp_code, warehouse_otp_verified_at, pickup_method, pickup_assigned_to, pickup_courier_name, pickup_awb, pickup_completed_at) FROM stdin;
1	1	\N	SN-DELL-5430-001	TTSPL0007	Dell	Latitude 5430	16 GB	512 GB SSD	12th Gen	complaint	2	Display / keyboard / touchpad	Screen flickering reported by customer.	15	open	\N	\N	\N	\N	\N	\N	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	\N	\N	\N	\N	\N	triage	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
2	2	\N	SN-DELL-5430-003	TTSPL0009	Dell	Latitude 5430	16 GB	512 GB SSD	12th Gen	replacement	\N	Battery / charging	Battery not charging; replacement requested.	15	progress	\N	\N	\N	\N	\N	\N	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	\N	\N	\N	\N	\N	in_repair	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
\.


--
-- Data for Name: support_tickets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.support_tickets (id, customer_id, customer_name, customer_phone, status, created_by, closed_by, closed_at, created_at, updated_at, last_activity_at, priority, top_level_remarks, ticket_phone_override, ticket_alt_phone, ticket_email, ticket_address, created_by_name, ticket_category, return_dc_number, complaint_type, serial_number, unique_number, delivery_person_id, assigned_parts, replaced_parts, ttspl_id, dc_number, sales_order_number, customer_portal_ticket, portal_customer_id) FROM stdin;
1	1	Amit Sharma	9876500001	open	14	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	high	\N	\N	\N	\N	\N	Pooja Nair	complaint	\N	\N	SN-DELL-5430-001	\N	\N	[]	[]	TTSPL0007	DC-0001	SO-0002	f	\N
2	2	Sunita Reddy	9876500002	progress	14	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	normal	\N	\N	\N	\N	\N	Pooja Nair	complaint	\N	\N	SN-DELL-5430-003	\N	\N	[]	[]	TTSPL0009	GDC-0001	GSO-0001	f	\N
\.


--
-- Data for Name: teams; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.teams (team_id, team_name, manager_id, created_at) FROM stdin;
1	Warehouse Team	\N	2026-06-11 14:20:06.887554+00
2	Diagnose Team	\N	2026-06-11 14:20:06.887554+00
3	Chip Level Repair Team	\N	2026-06-11 14:20:06.887554+00
4	Dismantle Team	\N	2026-06-11 14:20:06.887554+00
5	Procurement Team	\N	2026-06-11 14:20:06.887554+00
6	Vendor (Body & Paint)	\N	2026-06-11 14:20:06.887554+00
7	Assembly & Software Team	\N	2026-06-11 14:20:06.887554+00
8	Testing Team	\N	2026-06-11 14:20:06.887554+00
9	QC1 Team	\N	2026-06-11 14:20:06.887554+00
10	QC2 Team	\N	2026-06-11 14:20:06.887554+00
11	Inventory Team	\N	2026-06-11 14:20:06.887554+00
12	QC Team	\N	2026-06-11 14:20:12.750449+00
13	Dispatch Team	\N	2026-06-11 14:20:12.750449+00
14	Hardware & Software	\N	2026-06-11 14:20:14.938186+00
85	Hardware & Software	\N	2026-06-12 14:27:50.186732+00
86	QC1 Team	\N	2026-06-12 14:27:50.186732+00
87	QC2 Team	\N	2026-06-12 14:27:50.186732+00
88	Chip Level Repair Team	\N	2026-06-12 14:27:50.186732+00
89	Body & Paint Team	\N	2026-06-12 14:27:50.186732+00
90	Inventory Team	\N	2026-06-12 14:27:50.186732+00
91	Warehouse Team	\N	2026-06-12 14:27:50.186732+00
\.


--
-- Data for Name: ticket_checklist_progress; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ticket_checklist_progress (id, ticket_id, stage_id, checklist_data, completed_by, completed_at) FROM stdin;
\.


--
-- Data for Name: ticket_parts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ticket_parts (id, ticket_id, part_id, quantity_used, notes, added_at, unit_cost, is_upgrade) FROM stdin;
1	3	6	1	Replaced under repair	2026-06-14 11:57:00.158718+00	1100.00	f
\.


--
-- Data for Name: ticket_services; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ticket_services (service_id, ticket_id, service_type, cost, added_by, created_at) FROM stdin;
\.


--
-- Data for Name: tickets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tickets (ticket_id, serial_number, ttspl_id, machine_number, brand, model, processor, ram, storage, status, priority, current_stage_id, assigned_team_id, assigned_user_id, initial_condition, final_grade, initial_cost, created_at, updated_at, completed_at, vendor_serial_id, ticket_type, qc_fail_count, qc1_failed_at, qc2_failed_at, qc1_fail_reason, qc2_fail_reason, qc1_passed_at, qc2_passed_at, body_paint_required, chip_repair_required, highlighted, highlighted_reason, floor_manager_qc_failed, floor_manager_qc_failed_at, floor_manager_qc_fail_reason, return_to_vendor_dc_number, sales_order_id, sales_order_number) FROM stdin;
1	SN-DELL-3510-001	TTSPL0001	\N	Dell	Latitude 3510	Intel Core i5	8 GB	256 GB SSD	in_progress	normal	1	14	5	Good, minor dust	\N	0.00	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	1	grn_qc	0	\N	\N	\N	\N	\N	\N	f	f	f	\N	f	\N	\N	\N	\N	\N
2	SN-DELL-3510-002	TTSPL0002	\N	Dell	Latitude 3510	Intel Core i5	8 GB	256 GB SSD	in_progress	normal	2	14	6	Good condition	\N	0.00	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	2	grn_qc	0	\N	\N	\N	\N	\N	\N	f	f	f	\N	f	\N	\N	\N	\N	\N
3	SN-DELL-3510-003	TTSPL0003	\N	Dell	Latitude 3510	Intel Core i5	8 GB	256 GB SSD	in_progress	high	9	9	8	Minor scratches	\N	0.00	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	3	grn_qc	1	2026-06-13 11:57:00.158718+00	\N	Battery health below 50%	\N	\N	\N	f	f	t	QC1 failed: Battery health below 50%	f	\N	\N	\N	\N	\N
4	SN-DELL-5430-001	TTSPL0007	\N	Dell	Latitude 5430	Intel Core i5	16 GB	512 GB SSD	completed	high	10	10	\N	\N	\N	0.00	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	2026-06-13 11:57:00.158718+00	7	sales_order_qc	0	\N	\N	\N	\N	\N	\N	f	f	t	Sales Order	f	\N	\N	\N	\N	SO-0002
\.


--
-- Data for Name: ttspl_audit_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ttspl_audit_log (log_id, ttspl_id, vendor_serial_id, event_type, description, metadata, actor_user_id, actor_name, created_at) FROM stdin;
1	TTSPL0001	\N	received	Unit received via GRN	{}	\N	Sanjay Yadav	2026-05-25 11:57:00.158718+00
2	TTSPL0002	\N	received	Unit received via GRN	{}	\N	Sanjay Yadav	2026-05-25 11:57:00.158718+00
3	TTSPL0003	\N	received	Unit received via GRN	{}	\N	Sanjay Yadav	2026-05-25 11:57:00.158718+00
4	TTSPL0004	\N	received	Unit received via GRN	{}	\N	Sanjay Yadav	2026-05-25 11:57:00.158718+00
5	TTSPL0005	\N	received	Unit received via GRN	{}	\N	Sanjay Yadav	2026-05-25 11:57:00.158718+00
6	TTSPL0006	\N	received	Unit received via GRN	{}	\N	Sanjay Yadav	2026-05-25 11:57:00.158718+00
7	TTSPL0007	\N	received	Unit received via GRN	{}	\N	Sanjay Yadav	2026-05-25 11:57:00.158718+00
8	TTSPL0008	\N	received	Unit received via GRN	{}	\N	Sanjay Yadav	2026-05-25 11:57:00.158718+00
9	TTSPL0009	\N	received	Unit received via GRN	{}	\N	Sanjay Yadav	2026-05-25 11:57:00.158718+00
10	TTSPL0010	\N	received	Unit received via GRN	{}	\N	Sanjay Yadav	2026-05-25 11:57:00.158718+00
11	TTSPL0004	\N	qc_passed	QC2 passed — inventory ready	{}	\N	Mohan Gupta	2026-06-09 11:57:00.158718+00
12	TTSPL0005	\N	qc_passed	QC2 passed — inventory ready	{}	\N	Mohan Gupta	2026-06-09 11:57:00.158718+00
13	TTSPL0006	\N	qc_passed	QC2 passed — inventory ready	{}	\N	Mohan Gupta	2026-06-09 11:57:00.158718+00
14	TTSPL0007	\N	qc_passed	QC2 passed — inventory ready	{}	\N	Mohan Gupta	2026-06-09 11:57:00.158718+00
15	TTSPL0008	\N	qc_passed	QC2 passed — inventory ready	{}	\N	Mohan Gupta	2026-06-09 11:57:00.158718+00
16	TTSPL0009	\N	qc_passed	QC2 passed — inventory ready	{}	\N	Mohan Gupta	2026-06-09 11:57:00.158718+00
17	TTSPL0010	\N	qc_passed	QC2 passed — inventory ready	{}	\N	Mohan Gupta	2026-06-09 11:57:00.158718+00
18	TTSPL0007	7	status_rented	Delivered on DC-0001	{"to": "rented", "from": "in_transit", "entity": "rentfoxxy", "dc_number": "DC-0001", "customer_id": 1}	1	\N	2026-06-14 14:42:07.44842+00
\.


--
-- Data for Name: ttspl_config_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ttspl_config_history (history_id, ttspl_id, vendor_serial_id, ticket_id, changed_by, change_type, field_name, old_value, new_value, notes, part_used_id, part_cost, created_at) FROM stdin;
\.


--
-- Data for Name: user_permissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_permissions (id, user_id, section, can_view, can_create, can_edit, can_delete, granted_by, granted_at) FROM stdin;
\.


--
-- Data for Name: user_teams; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_teams (user_id, team_id) FROM stdin;
5	14
6	14
7	14
8	9
9	10
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (user_id, name, email, password_hash, role, team_id, active, barcode, permissions, created_at, updated_at, status, user_type, approved_by, approved_at, rejection_reason, company_name, gst_number, mobile_no, last_login, last_login_ip, deactivated_at, deactivated_by, deactivation_reason, profile_photo_url, designation, department, employee_id, joining_date, notes) FROM stdin;
1	Super Admin	superadmin@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	super_admin	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000001	\N	\N	\N	\N	\N	\N	Super Administrator	\N	\N	\N	\N
2	Admin User	admin@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	admin	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000002	\N	\N	\N	\N	\N	\N	Administrator	\N	\N	\N	\N
3	Raj Sharma	manager@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	manager	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000003	\N	\N	\N	\N	\N	\N	Operations Manager	\N	\N	\N	\N
4	Priya Mehta	sales@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	sales	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000004	\N	\N	\N	\N	\N	\N	Sales Executive	\N	\N	\N	\N
5	Vikram Singh	floor.manager@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	floor_manager	14	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000005	\N	\N	\N	\N	\N	\N	Floor Manager	\N	\N	\N	\N
6	Ravi Kumar	technician@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	team_member	14	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000006	\N	\N	\N	\N	\N	\N	Hardware Technician	\N	\N	\N	\N
7	Suresh Verma	senior.tech@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	team_lead	14	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000007	\N	\N	\N	\N	\N	\N	Senior Technician	\N	\N	\N	\N
8	Anita Singh	qc@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	qc	9	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000008	\N	\N	\N	\N	\N	\N	QC Inspector	\N	\N	\N	\N
9	Mohan Gupta	qc2@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	qc	10	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000009	\N	\N	\N	\N	\N	\N	Senior QC Inspector	\N	\N	\N	\N
10	Deepak Joshi	procurement@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	procurement	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000010	\N	\N	\N	\N	\N	\N	Procurement Executive	\N	\N	\N	\N
11	Sanjay Yadav	warehouse@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	warehouse	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000011	\N	\N	\N	\N	\N	\N	Warehouse Supervisor	\N	\N	\N	\N
12	Amit Kaur	dispatch@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	dispatch	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000012	\N	\N	\N	\N	\N	\N	Dispatch Executive	\N	\N	\N	\N
13	Neha Agarwal	accounts@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	accounts	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000013	\N	\N	\N	\N	\N	\N	Accounts Manager	\N	\N	\N	\N
14	Pooja Nair	support.lead@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	support_lead	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000014	\N	\N	\N	\N	\N	\N	Support Lead	\N	\N	\N	\N
15	Rahul Das	support.tech@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	support_tech	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000015	\N	\N	\N	\N	\N	\N	Support Technician	\N	\N	\N	\N
\.


--
-- Data for Name: vendor_audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_audit_logs (log_id, actor_user_id, vendor_id, entity_type, entity_id, action, payload, created_at) FROM stdin;
1	3	1	purchase_order	PO-0001	approved	{"note": "PO approved"}	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: vendor_billing; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_billing (billing_id, vendor_id, billing_month, billing_year, status, assigned_to_user_id, totals, detail, file_path, notes, created_at, updated_at, deleted_at) FROM stdin;
1	1	6	2026	pending	13	{"units": 1, "total_payable": 4130.00}	[{"amount": 3500.00, "ttspl_id": "TTSPL0004"}]	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N
\.


--
-- Data for Name: vendor_debit_notes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_debit_notes (debit_note_id, debit_note_number, vendor_id, po_id, reason, description, amount, quantity, unit_rate, ttspl_ids, status, adjusted_in_bill_id, created_by, approved_by, created_at, updated_at) FROM stdin;
1	DN-0001	1	1	Faulty unit	SN-DELL-3510-003 keyboard fault; repair cost deducted.	650.00	1	650.00	["TTSPL0003"]	approved	\N	13	13	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: vendor_goods_received_notes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_goods_received_notes (grn_id, po_id, meta, created_at, updated_at, deleted_at, spo_id, bill_status, bill_files, bill_name) FROM stdin;
1	1	{"notes": "All 6 units received.", "received_by": "Sanjay Yadav"}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	received	[]	INV-TECHRENT-3510-001
2	2	{"notes": "All 4 units received.", "received_by": "Sanjay Yadav"}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	received	[]	INV-TECHRENT-5430-001
\.


--
-- Data for Name: vendor_inventory_asset_sequence; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_inventory_asset_sequence (id, next_num) FROM stdin;
1	11
\.


--
-- Data for Name: vendor_monthly_bills; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_monthly_bills (bill_id, bill_number, vendor_id, bill_month, bill_year, bill_date, from_date, to_date, line_items, subtotal, gst_amount, debit_note_adjustment, total_payable, status, payment_date, payment_reference, notes, generated_by, approved_by, created_at, updated_at) FROM stdin;
1	VB-0001	1	5	2025	2025-05-31	2025-05-01	2025-05-31	[{"amount": 3500.00, "ttspl_id": "TTSPL0004", "monthly_rate": 3500, "serial_number": "SN-DELL-3510-004"}]	3500.00	630.00	0.00	4130.00	approved	\N	\N	\N	13	13	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: vendor_portal_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_portal_sessions (session_id, vendor_id, token, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: vendor_product_details; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_product_details (product_detail_id, po_id, category, brand, model, processor, generation, ram, storage, gpu, screen_size, quantity, rate, remarks, total_amount, vendor_locking_period, warranty, parts, status, random_id, old_product_id, old_product_details, created_at, updated_at) FROM stdin;
1	1	Laptop	Dell	Latitude 3510	Intel Core i5	10th Gen	8 GB	256 GB SSD	Integrated	15.6"	6	3500.00	\N	\N	12	12	\N	received	VPD-DELL3510	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
2	2	Laptop	Dell	Latitude 5430	Intel Core i5	12th Gen	16 GB	512 GB SSD	Integrated	14"	4	4500.00	\N	\N	12	12	\N	received	VPD-DELL5430	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
3	3	Laptop	HP	ProBook 440	Intel Core i5	11th Gen	8 GB	512 GB SSD	Integrated	14"	4	7000.00	\N	\N	12	12	\N	pending	VPD-HP440	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
4	4	Laptop	Lenovo	ThinkPad E14	Intel Core i7	12th Gen	16 GB	512 GB SSD	Integrated	14"	2	7500.00	\N	\N	24	24	\N	draft	VPD-LENE14	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: vendor_product_inventory; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_product_inventory (id, product_id, serial_id, serial_number, unique_product_serial, product_model_name, status, created_at, updated_at) FROM stdin;
1	\N	1	SN-DELL-3510-001	TTSPL0001	Latitude 3510	in_stock	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
2	\N	2	SN-DELL-3510-002	TTSPL0002	Latitude 3510	in_stock	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
3	\N	3	SN-DELL-3510-003	TTSPL0003	Latitude 3510	in_stock	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
4	\N	4	SN-DELL-3510-004	TTSPL0004	Latitude 3510	in_stock	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
5	\N	5	SN-DELL-3510-005	TTSPL0005	Latitude 3510	in_stock	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
6	\N	6	SN-DELL-3510-006	TTSPL0006	Latitude 3510	in_stock	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
7	\N	7	SN-DELL-5430-001	TTSPL0007	Latitude 5430	in_stock	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
8	\N	8	SN-DELL-5430-002	TTSPL0008	Latitude 5430	in_stock	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
9	\N	9	SN-DELL-5430-003	TTSPL0009	Latitude 5430	in_stock	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
10	\N	10	SN-DELL-5430-004	TTSPL0010	Latitude 5430	in_stock	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: vendor_purchase_orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_purchase_orders (po_id, purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, po_state, is_same_state, sub_total_amount, total_amount, line_items, assets_details, product_details_legacy_ids, remarks, public_token, status, invoice_created, invoice_path, rental_period, status_updated_by_admin_id, status_updated_by_name, created_at, updated_at, deleted_at, bill_name, bill_files, expected_delivery_date, rejection_reason, submitted_at, approved_at, sent_to_vendor_at, vendor_invoice_number, vendor_invoice_file, vendor_invoice_uploaded_at) FROM stdin;
1	PO-0001	2026-05-15	rental_purchase	1	Delhi	f	21000.00	24780.00	[{"gpu": "Integrated", "ram": "8 GB", "rate": 3500, "brand": "Dell", "model": "Latitude 3510", "storage": "256 GB SSD", "quantity": 6, "processor": "Intel Core i5", "generation": "10th Gen", "screen_size": "15.6\\"", "warranty_months": 12}]	\N	\N	\N	0a90ce25-5710-400c-a47b-dff358eb05f6	processing	f	\N	12 months @ 3500/month	3	Raj Sharma	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	[]	\N	\N	\N	2026-05-16 11:57:00.158718+00	2026-05-16 11:57:00.158718+00	\N	\N	\N
2	PO-0004	2026-05-20	rental_purchase	1	Delhi	f	18000.00	21240.00	[{"gpu": "Integrated", "ram": "16 GB", "rate": 4500, "brand": "Dell", "model": "Latitude 5430", "storage": "512 GB SSD", "quantity": 4, "processor": "Intel Core i5", "generation": "12th Gen", "screen_size": "14\\"", "warranty_months": 12}]	\N	\N	\N	88505634-79eb-49f1-b181-933a7aa77180	processing	f	\N	12 months @ 4500/month	3	Raj Sharma	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	[]	\N	\N	\N	2026-05-21 11:57:00.158718+00	2026-05-21 11:57:00.158718+00	\N	\N	\N
3	PO-0002	2026-06-12	direct_purchase	2	Delhi	f	28000.00	33040.00	[{"gpu": "Integrated", "ram": "8 GB", "rate": 7000, "brand": "HP", "model": "ProBook 440", "storage": "512 GB SSD", "quantity": 4, "processor": "Intel Core i5", "generation": "11th Gen", "screen_size": "14\\"", "warranty_months": 12}]	\N	\N	\N	269ef37e-9f27-4d8f-bf92-5da754c00727	pending_approval	f	\N	\N	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	[]	\N	\N	2026-06-13 11:57:00.158718+00	\N	\N	\N	\N	\N
4	PO-0003	2026-06-14	rent_to_own	1	Delhi	f	15000.00	17700.00	[{"gpu": "Integrated", "ram": "16 GB", "rate": 7500, "brand": "Lenovo", "model": "ThinkPad E14", "storage": "512 GB SSD", "quantity": 2, "processor": "Intel Core i7", "generation": "12th Gen", "screen_size": "14\\"", "warranty_months": 24}]	\N	\N	\N	d7806c58-4823-4e4e-a663-99a0d12dc4dd	draft	f	\N	\N	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	[]	\N	\N	\N	\N	\N	\N	\N	\N
\.


--
-- Data for Name: vendor_refresh_tokens; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_refresh_tokens (id, vendor_id, token_hash, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: vendor_replaced_products; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_replaced_products (replaced_id, vendor_id, po_id, payload, status, created_at, updated_at, deleted_at) FROM stdin;
\.


--
-- Data for Name: vendor_serial_number_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_serial_number_audit (audit_id, po_id, grn_id, old_serial, new_serial, changed_by_user_id, created_at) FROM stdin;
\.


--
-- Data for Name: vendor_serial_numbers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_serial_numbers (serial_id, po_id, grn_id, serial_number, extra, created_at, updated_at, deleted_at, spo_id, inventory_asset_code, rental_start_date, qc_status, inventory_status, remark, current_customer_id, current_dc_number, current_entity, dispatch_mode, dispatched_at, delivered_at, returned_at, rent_start_date, rent_end_date, rent_monthly_rate, status_changed_at) FROM stdin;
1	1	1	SN-DELL-3510-001	{"os": "Windows 11", "gpu": "Integrated", "ram": "8 GB", "brand": "Dell", "model": "Latitude 3510", "status": "in_qc", "storage": "256 GB SSD", "ttspl_id": "TTSPL0001", "condition": "Good", "processor": "Intel Core i5", "generation": "10th Gen", "screen_size": "15.6\\"", "product_detail_id": "1"}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	TTSPL0001	\N	in_qc	in_stock	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	3500.00	\N
2	1	1	SN-DELL-3510-002	{"os": "Windows 11", "gpu": "Integrated", "ram": "8 GB", "brand": "Dell", "model": "Latitude 3510", "status": "in_qc", "storage": "256 GB SSD", "ttspl_id": "TTSPL0002", "condition": "Good", "processor": "Intel Core i5", "generation": "10th Gen", "screen_size": "15.6\\"", "product_detail_id": "1"}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	TTSPL0002	\N	in_qc	in_stock	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	3500.00	\N
3	1	1	SN-DELL-3510-003	{"os": "None", "gpu": "Integrated", "ram": "8 GB", "brand": "Dell", "model": "Latitude 3510", "status": "in_qc", "storage": "256 GB SSD", "ttspl_id": "TTSPL0003", "condition": "Minor scratches", "processor": "Intel Core i5", "generation": "10th Gen", "screen_size": "15.6\\"", "product_detail_id": "1"}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	TTSPL0003	\N	in_qc	in_stock	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	3500.00	\N
8	2	2	SN-DELL-5430-002	{"os": "Windows 11", "gpu": "Integrated", "ram": "16 GB", "brand": "Dell", "model": "Latitude 5430", "status": "passed", "storage": "512 GB SSD", "ttspl_id": "TTSPL0008", "condition": "Good", "processor": "Intel Core i5", "generation": "12th Gen", "screen_size": "14\\"", "product_detail_id": "2"}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	TTSPL0008	\N	passed	in_stock	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	4500.00	\N
10	2	2	SN-DELL-5430-004	{"os": "Windows 11", "gpu": "Integrated", "ram": "16 GB", "brand": "Dell", "model": "Latitude 5430", "status": "passed", "storage": "512 GB SSD", "ttspl_id": "TTSPL0010", "condition": "Good", "processor": "Intel Core i5", "generation": "12th Gen", "screen_size": "14\\"", "product_detail_id": "2"}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	TTSPL0010	\N	passed	in_stock	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	4500.00	\N
4	1	1	SN-DELL-3510-004	{"os": "Windows 11", "gpu": "Integrated", "ram": "8 GB", "brand": "Dell", "model": "Latitude 3510", "status": "passed", "storage": "256 GB SSD", "ttspl_id": "TTSPL0004", "condition": "Good", "processor": "Intel Core i5", "generation": "10th Gen", "screen_size": "15.6\\"", "product_detail_id": "1"}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	TTSPL0004	\N	passed	reserved	\N	1	\N	\N	\N	\N	\N	\N	\N	\N	3500.00	2026-06-14 11:57:00.158718+00
5	1	1	SN-DELL-3510-005	{"os": "Windows 11", "gpu": "Integrated", "ram": "8 GB", "brand": "Dell", "model": "Latitude 3510", "status": "passed", "storage": "256 GB SSD", "ttspl_id": "TTSPL0005", "condition": "Good", "processor": "Intel Core i5", "generation": "10th Gen", "screen_size": "15.6\\"", "product_detail_id": "1"}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	TTSPL0005	\N	passed	reserved	\N	1	\N	\N	\N	\N	\N	\N	\N	\N	3500.00	2026-06-14 11:57:00.158718+00
9	2	2	SN-DELL-5430-003	{"os": "Windows 11", "gpu": "Integrated", "ram": "16 GB", "brand": "Dell", "model": "Latitude 5430", "status": "passed", "storage": "512 GB SSD", "ttspl_id": "TTSPL0009", "condition": "Good", "processor": "Intel Core i5", "generation": "12th Gen", "screen_size": "14\\"", "product_detail_id": "2"}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	TTSPL0009	\N	passed	sold	\N	2	GDC-0001	gorefurbo	courier	2026-06-08 11:57:00.158718+00	2026-06-10 11:57:00.158718+00	\N	\N	\N	4500.00	2026-06-10 11:57:00.158718+00
6	1	1	SN-DELL-3510-006	{"os": "Windows 11", "gpu": "Integrated", "ram": "8 GB", "brand": "Dell", "model": "Latitude 3510", "status": "passed", "storage": "256 GB SSD", "ttspl_id": "TTSPL0006", "condition": "Good", "processor": "Intel Core i5", "generation": "10th Gen", "screen_size": "15.6\\"", "product_detail_id": "1"}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	\N	TTSPL0006	\N	passed	on_demo	\N	3	DC-0002	rentfoxxy	inhouse	2026-06-11 11:57:00.158718+00	2026-06-12 11:57:00.158718+00	\N	\N	\N	3500.00	2026-06-12 11:57:00.158718+00
7	2	2	SN-DELL-5430-001	{"os": "Windows 11", "gpu": "Integrated", "ram": "16 GB", "brand": "Dell", "model": "Latitude 5430", "status": "passed", "storage": "512 GB SSD", "ttspl_id": "TTSPL0007", "condition": "Good", "processor": "Intel Core i5", "generation": "12th Gen", "screen_size": "14\\"", "product_detail_id": "2"}	2026-06-14 11:57:00.158718+00	2026-06-14 14:42:07.44842+00	\N	\N	TTSPL0007	\N	passed	rented	\N	1	DC-0001	rentfoxxy	courier	2026-06-13 11:57:00.158718+00	2026-06-14 14:42:09.921+00	\N	2026-06-14	\N	4500.00	2026-06-14 14:42:07.44842+00
\.


--
-- Data for Name: vendor_shops; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_shops (shop_id, vendor_id, name, address, contact, image_url, banner_url, created_at, updated_at, deleted_at) FROM stdin;
1	1	TechRent Supplies Pvt Ltd — Main Shop	Plot 45, Sector 18, NSEZ, Noida	9811122233	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N
\.


--
-- Data for Name: vendor_spare_parts_catalog; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_spare_parts_catalog (part_id, name, active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: vendor_spare_parts_purchase_orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_spare_parts_purchase_orders (spo_id, purchase_order_number, purchase_order_date, vendor_id, po_state, is_same_state, sub_total_amount, total_amount, line_items, assets_details, remarks, public_token, status, status_updated_by_admin_id, status_updated_by_name, created_at, updated_at, deleted_at, bill_name, bill_files) FROM stdin;
\.


--
-- Data for Name: vendor_wallets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_wallets (wallet_id, vendor_id, withdrawn, commission_given, total_earning, pending_withdraw, delivery_charge_earned, collected_cash, created_at, updated_at) FROM stdin;
1	1	0.00	0.00	0.00	0.00	0.00	0.00	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
2	2	0.00	0.00	0.00	0.00	0.00	0.00	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00
\.


--
-- Data for Name: vendors; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendors (vendor_id, status, first_name, last_name, business_name, email, phone, password_hash, address, business_type, registration_date, state, gst_number, brand_code, business_registration_number, tax_identification_number, bank_name, account_number, bank_ifsc_code, account_holder_name, image_url, licenses_url, remember_pass_plain, created_at, updated_at, deleted_at, vendor_portal_password_hash, vendor_portal_last_login, vendor_portal_enabled, po_payment_terms, credit_days, pan_number, msme_number, contact_person_name, contact_person_phone, alternate_phone, city, pincode, logo_url, notes) FROM stdin;
1	approved	Bibhaw	Raj	TechRent Supplies Pvt Ltd	vendor@techrent.com	9811122233	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	Plot 45, Sector 18, NSEZ, Noida	Pvt Ltd	2019-04-01	Uttar Pradesh	09AABCT1234A1Z5	\N	\N	\N	HDFC Bank	50200012345678	HDFC0001234	TechRent Supplies Pvt Ltd	\N	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	\N	t	postpaid_monthly	1	AABCT1234A	\N	Amit Gupta	9811122234	\N	Noida	201301	\N	Primary laptop rental vendor (Dell & Lenovo).
2	approved	Sunita	Kapoor	Kapoor Laptops	vendor2@kapoorlaptops.com	9822233344	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	12, Nehru Place, New Delhi	Proprietorship	2020-06-15	Delhi	07AAUPK5678B1Z1	\N	\N	\N	SBI	3210054321012	SBIN0001099	Sunita Kapoor	\N	\N	\N	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	\N	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	\N	t	net30	30	AAUPK5678B	\N	Sunita Kapoor	9822233344	\N	New Delhi	110019	\N	HP and Asus specialist vendor.
\.


--
-- Data for Name: work_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.work_logs (log_id, ticket_id, user_id, stage_id, start_time, end_time, notes, created_at) FROM stdin;
1	2	6	2	2026-06-14 09:57:00.158718+00	2026-06-14 10:57:00.158718+00	Diagnosis completed	2026-06-14 11:57:00.158718+00
\.


--
-- Name: activities_activity_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.activities_activity_id_seq', 1, true);


--
-- Name: allocation_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.allocation_logs_id_seq', 3, true);


--
-- Name: chip_level_repairs_repair_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.chip_level_repairs_repair_id_seq', 1, false);


--
-- Name: companies_company_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.companies_company_id_seq', 2, true);


--
-- Name: customer_addresses_customer_address_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.customer_addresses_customer_address_id_seq', 4, true);


--
-- Name: customer_credit_notes_credit_note_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.customer_credit_notes_credit_note_id_seq', 1, true);


--
-- Name: customer_documents_doc_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.customer_documents_doc_id_seq', 6, true);


--
-- Name: customer_inventory_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.customer_inventory_id_seq', 1, false);


--
-- Name: customer_invoices_invoice_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.customer_invoices_invoice_id_seq', 2, true);


--
-- Name: customer_portal_sessions_session_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.customer_portal_sessions_session_id_seq', 1, false);


--
-- Name: customer_security_deposits_deposit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.customer_security_deposits_deposit_id_seq', 1, true);


--
-- Name: customers_customer_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.customers_customer_id_seq', 4, true);


--
-- Name: dc_qc_tickets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.dc_qc_tickets_id_seq', 1, true);


--
-- Name: delivery_challan_lines_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.delivery_challan_lines_id_seq', 3, true);


--
-- Name: delivery_technicians_technician_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.delivery_technicians_technician_id_seq', 1, true);


--
-- Name: demo_agreements_demo_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.demo_agreements_demo_id_seq', 1, true);


--
-- Name: diagnosis_images_image_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.diagnosis_images_image_id_seq', 1, false);


--
-- Name: diagnosis_parts_required_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.diagnosis_parts_required_id_seq', 1, false);


--
-- Name: diagnosis_results_diagnosis_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.diagnosis_results_diagnosis_id_seq', 1, false);


--
-- Name: einvoice_records_record_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.einvoice_records_record_id_seq', 1, false);


--
-- Name: email_queue_email_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.email_queue_email_id_seq', 1, false);


--
-- Name: eway_bill_records_record_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.eway_bill_records_record_id_seq', 1, false);


--
-- Name: inventory_inventory_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.inventory_inventory_id_seq', 7, true);


--
-- Name: inventory_status_transitions_transition_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.inventory_status_transitions_transition_id_seq', 6, true);


--
-- Name: inward_outward_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.inward_outward_id_seq', 1, false);


--
-- Name: laptop_catalog_catalog_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.laptop_catalog_catalog_id_seq', 1, false);


--
-- Name: lead_activities_activity_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.lead_activities_activity_id_seq', 1, true);


--
-- Name: lead_addresses_address_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.lead_addresses_address_id_seq', 1, true);


--
-- Name: lead_assignments_assignment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.lead_assignments_assignment_id_seq', 1, false);


--
-- Name: lead_auto_assign_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.lead_auto_assign_config_id_seq', 1, false);


--
-- Name: lead_company_research_research_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.lead_company_research_research_id_seq', 1, true);


--
-- Name: lead_followup_notifications_notification_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.lead_followup_notifications_notification_id_seq', 1, false);


--
-- Name: lead_import_logs_import_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.lead_import_logs_import_id_seq', 1, false);


--
-- Name: lead_orders_lead_order_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.lead_orders_lead_order_id_seq', 1, false);


--
-- Name: lead_remarks_remark_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.lead_remarks_remark_id_seq', 1, true);


--
-- Name: leads_lead_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.leads_lead_id_seq', 7, true);


--
-- Name: order_items_item_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.order_items_item_id_seq', 1, false);


--
-- Name: orders_order_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.orders_order_id_seq', 1, false);


--
-- Name: part_requests_request_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.part_requests_request_id_seq', 1, false);


--
-- Name: parts_part_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.parts_part_id_seq', 20, true);


--
-- Name: permission_audit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.permission_audit_logs_id_seq', 1, false);


--
-- Name: permission_sections_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.permission_sections_id_seq', 1420, true);


--
-- Name: photos_photo_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.photos_photo_id_seq', 1, false);


--
-- Name: procurement_requests_request_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.procurement_requests_request_id_seq', 1, false);


--
-- Name: qc_photos_photo_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.qc_photos_photo_id_seq', 1, false);


--
-- Name: qc_results_qc_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.qc_results_qc_id_seq', 1, true);


--
-- Name: rent_devices_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.rent_devices_id_seq', 1, true);


--
-- Name: repair_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.repair_logs_id_seq', 1, false);


--
-- Name: role_permissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.role_permissions_id_seq', 6203, true);


--
-- Name: roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.roles_id_seq', 157, true);


--
-- Name: sales_order_lines_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sales_order_lines_id_seq', 4, true);


--
-- Name: sales_order_payments_payment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sales_order_payments_payment_id_seq', 2, true);


--
-- Name: sales_order_serials_allocation_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sales_order_serials_allocation_id_seq', 5, true);


--
-- Name: sales_quotations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sales_quotations_id_seq', 3, true);


--
-- Name: sm_courier_details_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sm_courier_details_id_seq', 1, false);


--
-- Name: spare_parts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.spare_parts_id_seq', 1, true);


--
-- Name: stage_checklists_checklist_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.stage_checklists_checklist_id_seq', 1, false);


--
-- Name: stage_transition_rules_rule_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.stage_transition_rules_rule_id_seq', 36, true);


--
-- Name: stages_stage_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.stages_stage_id_seq', 11, true);


--
-- Name: support_issue_categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.support_issue_categories_id_seq', 259, true);


--
-- Name: support_replacement_orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.support_replacement_orders_id_seq', 1, false);


--
-- Name: support_ticket_item_audit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.support_ticket_item_audit_id_seq', 1, true);


--
-- Name: support_ticket_item_comments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.support_ticket_item_comments_id_seq', 1, true);


--
-- Name: support_ticket_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.support_ticket_items_id_seq', 2, true);


--
-- Name: support_tickets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.support_tickets_id_seq', 2, true);


--
-- Name: teams_team_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.teams_team_id_seq', 91, true);


--
-- Name: ticket_checklist_progress_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ticket_checklist_progress_id_seq', 1, false);


--
-- Name: ticket_parts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ticket_parts_id_seq', 1, true);


--
-- Name: ticket_services_service_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ticket_services_service_id_seq', 1, false);


--
-- Name: tickets_ticket_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tickets_ticket_id_seq', 4, true);


--
-- Name: ttspl_audit_log_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ttspl_audit_log_log_id_seq', 18, true);


--
-- Name: ttspl_config_history_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ttspl_config_history_history_id_seq', 1, false);


--
-- Name: user_permissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_permissions_id_seq', 1, false);


--
-- Name: users_user_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_user_id_seq', 15, true);


--
-- Name: vendor_audit_logs_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_audit_logs_log_id_seq', 1, true);


--
-- Name: vendor_billing_billing_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_billing_billing_id_seq', 1, true);


--
-- Name: vendor_debit_notes_debit_note_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_debit_notes_debit_note_id_seq', 1, true);


--
-- Name: vendor_goods_received_notes_grn_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_goods_received_notes_grn_id_seq', 2, true);


--
-- Name: vendor_monthly_bills_bill_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_monthly_bills_bill_id_seq', 1, true);


--
-- Name: vendor_portal_sessions_session_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_portal_sessions_session_id_seq', 1, false);


--
-- Name: vendor_product_details_product_detail_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_product_details_product_detail_id_seq', 4, true);


--
-- Name: vendor_product_inventory_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_product_inventory_id_seq', 10, true);


--
-- Name: vendor_purchase_orders_po_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_purchase_orders_po_id_seq', 4, true);


--
-- Name: vendor_refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_refresh_tokens_id_seq', 1, false);


--
-- Name: vendor_replaced_products_replaced_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_replaced_products_replaced_id_seq', 1, false);


--
-- Name: vendor_serial_number_audit_audit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_serial_number_audit_audit_id_seq', 1, false);


--
-- Name: vendor_serial_numbers_serial_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_serial_numbers_serial_id_seq', 10, true);


--
-- Name: vendor_shops_shop_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_shops_shop_id_seq', 1, true);


--
-- Name: vendor_spare_parts_catalog_part_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_spare_parts_catalog_part_id_seq', 1, false);


--
-- Name: vendor_spare_parts_purchase_orders_spo_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_spare_parts_purchase_orders_spo_id_seq', 1, false);


--
-- Name: vendor_wallets_wallet_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_wallets_wallet_id_seq', 2, true);


--
-- Name: vendors_vendor_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendors_vendor_id_seq', 2, true);


--
-- Name: work_logs_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.work_logs_log_id_seq', 1, true);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (activity_id);


--
-- Name: allocation_logs allocation_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allocation_logs
    ADD CONSTRAINT allocation_logs_pkey PRIMARY KEY (id);


--
-- Name: chip_level_repairs chip_level_repairs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chip_level_repairs
    ADD CONSTRAINT chip_level_repairs_pkey PRIMARY KEY (repair_id);


--
-- Name: chip_level_repairs chip_level_repairs_ticket_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chip_level_repairs
    ADD CONSTRAINT chip_level_repairs_ticket_id_key UNIQUE (ticket_id);


--
-- Name: companies companies_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_code_key UNIQUE (code);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (company_id);


--
-- Name: customer_addresses customer_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_addresses
    ADD CONSTRAINT customer_addresses_pkey PRIMARY KEY (customer_address_id);


--
-- Name: customer_addresses customer_addresses_source_lead_address_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_addresses
    ADD CONSTRAINT customer_addresses_source_lead_address_id_key UNIQUE (source_lead_address_id);


--
-- Name: customer_credit_notes customer_credit_notes_credit_note_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_credit_notes
    ADD CONSTRAINT customer_credit_notes_credit_note_number_key UNIQUE (credit_note_number);


--
-- Name: customer_credit_notes customer_credit_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_credit_notes
    ADD CONSTRAINT customer_credit_notes_pkey PRIMARY KEY (credit_note_id);


--
-- Name: customer_documents customer_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_documents
    ADD CONSTRAINT customer_documents_pkey PRIMARY KEY (doc_id);


--
-- Name: customer_inventory customer_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_inventory
    ADD CONSTRAINT customer_inventory_pkey PRIMARY KEY (id);


--
-- Name: customer_invoices customer_invoices_customer_id_invoice_month_invoice_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invoices
    ADD CONSTRAINT customer_invoices_customer_id_invoice_month_invoice_year_key UNIQUE (customer_id, invoice_month, invoice_year);


--
-- Name: customer_invoices customer_invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invoices
    ADD CONSTRAINT customer_invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: customer_invoices customer_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invoices
    ADD CONSTRAINT customer_invoices_pkey PRIMARY KEY (invoice_id);


--
-- Name: customer_portal_sessions customer_portal_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_portal_sessions
    ADD CONSTRAINT customer_portal_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: customer_portal_sessions customer_portal_sessions_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_portal_sessions
    ADD CONSTRAINT customer_portal_sessions_token_key UNIQUE (token);


--
-- Name: customer_security_deposits customer_security_deposits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_security_deposits
    ADD CONSTRAINT customer_security_deposits_pkey PRIMARY KEY (deposit_id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (customer_id);


--
-- Name: dc_qc_tickets dc_qc_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_qc_tickets
    ADD CONSTRAINT dc_qc_tickets_pkey PRIMARY KEY (id);


--
-- Name: delivery_challan_lines delivery_challan_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_challan_lines
    ADD CONSTRAINT delivery_challan_lines_pkey PRIMARY KEY (id);


--
-- Name: delivery_technicians delivery_technicians_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_technicians
    ADD CONSTRAINT delivery_technicians_pkey PRIMARY KEY (technician_id);


--
-- Name: demo_agreements demo_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_agreements
    ADD CONSTRAINT demo_agreements_pkey PRIMARY KEY (demo_id);


--
-- Name: diagnosis_images diagnosis_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnosis_images
    ADD CONSTRAINT diagnosis_images_pkey PRIMARY KEY (image_id);


--
-- Name: diagnosis_parts_required diagnosis_parts_required_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnosis_parts_required
    ADD CONSTRAINT diagnosis_parts_required_pkey PRIMARY KEY (id);


--
-- Name: diagnosis_results diagnosis_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnosis_results
    ADD CONSTRAINT diagnosis_results_pkey PRIMARY KEY (diagnosis_id);


--
-- Name: diagnosis_results diagnosis_results_ticket_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnosis_results
    ADD CONSTRAINT diagnosis_results_ticket_id_key UNIQUE (ticket_id);


--
-- Name: einvoice_records einvoice_records_irn_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einvoice_records
    ADD CONSTRAINT einvoice_records_irn_key UNIQUE (irn);


--
-- Name: einvoice_records einvoice_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einvoice_records
    ADD CONSTRAINT einvoice_records_pkey PRIMARY KEY (record_id);


--
-- Name: email_queue email_queue_dedupe_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_queue
    ADD CONSTRAINT email_queue_dedupe_key_key UNIQUE (dedupe_key);


--
-- Name: email_queue email_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_queue
    ADD CONSTRAINT email_queue_pkey PRIMARY KEY (email_id);


--
-- Name: eway_bill_records eway_bill_records_ewb_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eway_bill_records
    ADD CONSTRAINT eway_bill_records_ewb_number_key UNIQUE (ewb_number);


--
-- Name: eway_bill_records eway_bill_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eway_bill_records
    ADD CONSTRAINT eway_bill_records_pkey PRIMARY KEY (record_id);


--
-- Name: existing_customer existing_customer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.existing_customer
    ADD CONSTRAINT existing_customer_pkey PRIMARY KEY (customer_id);


--
-- Name: inventory inventory_machine_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_machine_number_key UNIQUE (machine_number);


--
-- Name: inventory inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_pkey PRIMARY KEY (inventory_id);


--
-- Name: inventory inventory_serial_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_serial_number_key UNIQUE (serial_number);


--
-- Name: inventory_status_transitions inventory_status_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_status_transitions
    ADD CONSTRAINT inventory_status_transitions_pkey PRIMARY KEY (transition_id);


--
-- Name: inward_outward inward_outward_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inward_outward
    ADD CONSTRAINT inward_outward_pkey PRIMARY KEY (id);


--
-- Name: laptop_catalog laptop_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.laptop_catalog
    ADD CONSTRAINT laptop_catalog_pkey PRIMARY KEY (catalog_id);


--
-- Name: lead_activities lead_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_pkey PRIMARY KEY (activity_id);


--
-- Name: lead_addresses lead_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_addresses
    ADD CONSTRAINT lead_addresses_pkey PRIMARY KEY (address_id);


--
-- Name: lead_assignments lead_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_assignments
    ADD CONSTRAINT lead_assignments_pkey PRIMARY KEY (assignment_id);


--
-- Name: lead_auto_assign_config lead_auto_assign_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_auto_assign_config
    ADD CONSTRAINT lead_auto_assign_config_pkey PRIMARY KEY (id);


--
-- Name: lead_company_research lead_company_research_lead_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_company_research
    ADD CONSTRAINT lead_company_research_lead_id_key UNIQUE (lead_id);


--
-- Name: lead_company_research lead_company_research_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_company_research
    ADD CONSTRAINT lead_company_research_pkey PRIMARY KEY (research_id);


--
-- Name: lead_followup_notifications lead_followup_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_followup_notifications
    ADD CONSTRAINT lead_followup_notifications_pkey PRIMARY KEY (notification_id);


--
-- Name: lead_import_logs lead_import_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_import_logs
    ADD CONSTRAINT lead_import_logs_pkey PRIMARY KEY (import_id);


--
-- Name: lead_orders lead_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_orders
    ADD CONSTRAINT lead_orders_pkey PRIMARY KEY (lead_order_id);


--
-- Name: lead_remarks lead_remarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_remarks
    ADD CONSTRAINT lead_remarks_pkey PRIMARY KEY (remark_id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (lead_id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (item_id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (order_id);


--
-- Name: part_requests part_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_requests
    ADD CONSTRAINT part_requests_pkey PRIMARY KEY (request_id);


--
-- Name: parts parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_pkey PRIMARY KEY (part_id);


--
-- Name: permission_audit_logs permission_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_audit_logs
    ADD CONSTRAINT permission_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: permission_sections permission_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_sections
    ADD CONSTRAINT permission_sections_pkey PRIMARY KEY (id);


--
-- Name: permission_sections permission_sections_section_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_sections
    ADD CONSTRAINT permission_sections_section_key UNIQUE (section);


--
-- Name: photos photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_pkey PRIMARY KEY (photo_id);


--
-- Name: procurement_requests procurement_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_requests
    ADD CONSTRAINT procurement_requests_pkey PRIMARY KEY (request_id);


--
-- Name: qc_photos qc_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_photos
    ADD CONSTRAINT qc_photos_pkey PRIMARY KEY (photo_id);


--
-- Name: qc_results qc_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_results
    ADD CONSTRAINT qc_results_pkey PRIMARY KEY (qc_id);


--
-- Name: qc_round_robin_state qc_round_robin_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_round_robin_state
    ADD CONSTRAINT qc_round_robin_state_pkey PRIMARY KEY (team_id);


--
-- Name: rent_devices rent_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rent_devices
    ADD CONSTRAINT rent_devices_pkey PRIMARY KEY (id);


--
-- Name: repair_logs repair_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_logs
    ADD CONSTRAINT repair_logs_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_role_section_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_section_key UNIQUE (role, section);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: sales_order_lines sales_order_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_lines
    ADD CONSTRAINT sales_order_lines_pkey PRIMARY KEY (id);


--
-- Name: sales_order_payments sales_order_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_payments
    ADD CONSTRAINT sales_order_payments_pkey PRIMARY KEY (payment_id);


--
-- Name: sales_order_serials sales_order_serials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_serials
    ADD CONSTRAINT sales_order_serials_pkey PRIMARY KEY (allocation_id);


--
-- Name: sales_quotations sales_quotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotations
    ADD CONSTRAINT sales_quotations_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);


--
-- Name: sm_courier_details sm_courier_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_courier_details
    ADD CONSTRAINT sm_courier_details_pkey PRIMARY KEY (id);


--
-- Name: sm_document_sequences sm_document_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_document_sequences
    ADD CONSTRAINT sm_document_sequences_pkey PRIMARY KEY (doc_type);


--
-- Name: spare_parts spare_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spare_parts
    ADD CONSTRAINT spare_parts_pkey PRIMARY KEY (id);


--
-- Name: stage_checklists stage_checklists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_checklists
    ADD CONSTRAINT stage_checklists_pkey PRIMARY KEY (checklist_id);


--
-- Name: stage_transition_rules stage_transition_rules_from_stage_name_to_stage_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_transition_rules
    ADD CONSTRAINT stage_transition_rules_from_stage_name_to_stage_name_key UNIQUE (from_stage_name, to_stage_name);


--
-- Name: stage_transition_rules stage_transition_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_transition_rules
    ADD CONSTRAINT stage_transition_rules_pkey PRIMARY KEY (rule_id);


--
-- Name: stages stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stages
    ADD CONSTRAINT stages_pkey PRIMARY KEY (stage_id);


--
-- Name: support_issue_categories support_issue_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_issue_categories
    ADD CONSTRAINT support_issue_categories_name_key UNIQUE (name);


--
-- Name: support_issue_categories support_issue_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_issue_categories
    ADD CONSTRAINT support_issue_categories_pkey PRIMARY KEY (id);


--
-- Name: support_replacement_orders support_replacement_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_replacement_orders
    ADD CONSTRAINT support_replacement_orders_pkey PRIMARY KEY (id);


--
-- Name: support_settings support_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_settings
    ADD CONSTRAINT support_settings_pkey PRIMARY KEY (key);


--
-- Name: support_ticket_item_audit support_ticket_item_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_item_audit
    ADD CONSTRAINT support_ticket_item_audit_pkey PRIMARY KEY (id);


--
-- Name: support_ticket_item_comments support_ticket_item_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_item_comments
    ADD CONSTRAINT support_ticket_item_comments_pkey PRIMARY KEY (id);


--
-- Name: support_ticket_items support_ticket_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (team_id);


--
-- Name: ticket_checklist_progress ticket_checklist_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_checklist_progress
    ADD CONSTRAINT ticket_checklist_progress_pkey PRIMARY KEY (id);


--
-- Name: ticket_parts ticket_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_parts
    ADD CONSTRAINT ticket_parts_pkey PRIMARY KEY (id);


--
-- Name: ticket_services ticket_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_services
    ADD CONSTRAINT ticket_services_pkey PRIMARY KEY (service_id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (ticket_id);


--
-- Name: ttspl_audit_log ttspl_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ttspl_audit_log
    ADD CONSTRAINT ttspl_audit_log_pkey PRIMARY KEY (log_id);


--
-- Name: ttspl_config_history ttspl_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ttspl_config_history
    ADD CONSTRAINT ttspl_config_history_pkey PRIMARY KEY (history_id);


--
-- Name: lead_followup_notifications unique_lead_followup_email_notification; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_followup_notifications
    ADD CONSTRAINT unique_lead_followup_email_notification UNIQUE (lead_id, follow_up_at, recipient_email, channel);


--
-- Name: qc_results unique_ticket_qc_stage; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_results
    ADD CONSTRAINT unique_ticket_qc_stage UNIQUE (ticket_id, qc_stage);


--
-- Name: laptop_catalog uq_laptop_catalog; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.laptop_catalog
    ADD CONSTRAINT uq_laptop_catalog UNIQUE (brand, model, processor, generation, ram, storage, device_type);


--
-- Name: user_permissions user_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (id);


--
-- Name: user_permissions user_permissions_user_id_section_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_section_key UNIQUE (user_id, section);


--
-- Name: user_teams user_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_teams
    ADD CONSTRAINT user_teams_pkey PRIMARY KEY (user_id, team_id);


--
-- Name: users users_barcode_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_barcode_key UNIQUE (barcode);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: vendor_audit_logs vendor_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_audit_logs
    ADD CONSTRAINT vendor_audit_logs_pkey PRIMARY KEY (log_id);


--
-- Name: vendor_billing vendor_billing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_billing
    ADD CONSTRAINT vendor_billing_pkey PRIMARY KEY (billing_id);


--
-- Name: vendor_debit_notes vendor_debit_notes_debit_note_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_debit_notes
    ADD CONSTRAINT vendor_debit_notes_debit_note_number_key UNIQUE (debit_note_number);


--
-- Name: vendor_debit_notes vendor_debit_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_debit_notes
    ADD CONSTRAINT vendor_debit_notes_pkey PRIMARY KEY (debit_note_id);


--
-- Name: vendor_goods_received_notes vendor_goods_received_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_goods_received_notes
    ADD CONSTRAINT vendor_goods_received_notes_pkey PRIMARY KEY (grn_id);


--
-- Name: vendor_inventory_asset_sequence vendor_inventory_asset_sequence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_inventory_asset_sequence
    ADD CONSTRAINT vendor_inventory_asset_sequence_pkey PRIMARY KEY (id);


--
-- Name: vendor_monthly_bills vendor_monthly_bills_bill_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_monthly_bills
    ADD CONSTRAINT vendor_monthly_bills_bill_number_key UNIQUE (bill_number);


--
-- Name: vendor_monthly_bills vendor_monthly_bills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_monthly_bills
    ADD CONSTRAINT vendor_monthly_bills_pkey PRIMARY KEY (bill_id);


--
-- Name: vendor_monthly_bills vendor_monthly_bills_vendor_id_bill_month_bill_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_monthly_bills
    ADD CONSTRAINT vendor_monthly_bills_vendor_id_bill_month_bill_year_key UNIQUE (vendor_id, bill_month, bill_year);


--
-- Name: vendor_portal_sessions vendor_portal_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_portal_sessions
    ADD CONSTRAINT vendor_portal_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: vendor_portal_sessions vendor_portal_sessions_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_portal_sessions
    ADD CONSTRAINT vendor_portal_sessions_token_key UNIQUE (token);


--
-- Name: vendor_product_details vendor_product_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_product_details
    ADD CONSTRAINT vendor_product_details_pkey PRIMARY KEY (product_detail_id);


--
-- Name: vendor_product_inventory vendor_product_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_product_inventory
    ADD CONSTRAINT vendor_product_inventory_pkey PRIMARY KEY (id);


--
-- Name: vendor_purchase_orders vendor_purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_purchase_orders
    ADD CONSTRAINT vendor_purchase_orders_pkey PRIMARY KEY (po_id);


--
-- Name: vendor_purchase_orders vendor_purchase_orders_purchase_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_purchase_orders
    ADD CONSTRAINT vendor_purchase_orders_purchase_order_number_key UNIQUE (purchase_order_number);


--
-- Name: vendor_refresh_tokens vendor_refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_refresh_tokens
    ADD CONSTRAINT vendor_refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: vendor_replaced_products vendor_replaced_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_replaced_products
    ADD CONSTRAINT vendor_replaced_products_pkey PRIMARY KEY (replaced_id);


--
-- Name: vendor_serial_number_audit vendor_serial_number_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_serial_number_audit
    ADD CONSTRAINT vendor_serial_number_audit_pkey PRIMARY KEY (audit_id);


--
-- Name: vendor_serial_numbers vendor_serial_numbers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_serial_numbers
    ADD CONSTRAINT vendor_serial_numbers_pkey PRIMARY KEY (serial_id);


--
-- Name: vendor_shops vendor_shops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_shops
    ADD CONSTRAINT vendor_shops_pkey PRIMARY KEY (shop_id);


--
-- Name: vendor_spare_parts_catalog vendor_spare_parts_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_spare_parts_catalog
    ADD CONSTRAINT vendor_spare_parts_catalog_pkey PRIMARY KEY (part_id);


--
-- Name: vendor_spare_parts_purchase_orders vendor_spare_parts_purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_spare_parts_purchase_orders
    ADD CONSTRAINT vendor_spare_parts_purchase_orders_pkey PRIMARY KEY (spo_id);


--
-- Name: vendor_spare_parts_purchase_orders vendor_spare_parts_purchase_orders_purchase_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_spare_parts_purchase_orders
    ADD CONSTRAINT vendor_spare_parts_purchase_orders_purchase_order_number_key UNIQUE (purchase_order_number);


--
-- Name: vendor_wallets vendor_wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_wallets
    ADD CONSTRAINT vendor_wallets_pkey PRIMARY KEY (wallet_id);


--
-- Name: vendor_wallets vendor_wallets_vendor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_wallets
    ADD CONSTRAINT vendor_wallets_vendor_id_key UNIQUE (vendor_id);


--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (vendor_id);


--
-- Name: work_logs work_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT work_logs_pkey PRIMARY KEY (log_id);


--
-- Name: customers_source_lead_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_source_lead_id_key ON public.customers USING btree (source_lead_id) WHERE (source_lead_id IS NOT NULL);


--
-- Name: idx_activities_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_ticket ON public.activities USING btree (ticket_id);


--
-- Name: idx_allocation_logs_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_allocation_logs_product ON public.allocation_logs USING btree (product_id);


--
-- Name: idx_allocation_logs_serial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_allocation_logs_serial ON public.allocation_logs USING btree (serial_number);


--
-- Name: idx_allocation_logs_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_allocation_logs_vendor ON public.allocation_logs USING btree (vendor_id);


--
-- Name: idx_credit_notes_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_notes_customer ON public.customer_credit_notes USING btree (customer_id);


--
-- Name: idx_customer_addresses_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_addresses_customer_id ON public.customer_addresses USING btree (customer_id);


--
-- Name: idx_customer_docs_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_docs_customer ON public.customer_documents USING btree (customer_id);


--
-- Name: idx_customer_inventory_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_inventory_customer ON public.customer_inventory USING btree (customer_id);


--
-- Name: idx_customer_inventory_serial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_inventory_serial ON public.customer_inventory USING btree (serial_number);


--
-- Name: idx_customer_inventory_unique_serial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_inventory_unique_serial ON public.customer_inventory USING btree (unique_serial_number);


--
-- Name: idx_customer_invoices_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_invoices_customer ON public.customer_invoices USING btree (customer_id);


--
-- Name: idx_customer_invoices_month_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_invoices_month_year ON public.customer_invoices USING btree (invoice_year, invoice_month);


--
-- Name: idx_customer_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_invoices_status ON public.customer_invoices USING btree (status);


--
-- Name: idx_customer_portal_sessions_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_portal_sessions_customer ON public.customer_portal_sessions USING btree (customer_id);


--
-- Name: idx_customer_portal_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_portal_sessions_expires ON public.customer_portal_sessions USING btree (expires_at);


--
-- Name: idx_customers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_status ON public.customers USING btree (status);


--
-- Name: idx_customers_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_updated_at ON public.customers USING btree (updated_at DESC);


--
-- Name: idx_dc_qc_tickets_dc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dc_qc_tickets_dc ON public.dc_qc_tickets USING btree (dc_number);


--
-- Name: idx_delivery_challan_lines_dc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delivery_challan_lines_dc ON public.delivery_challan_lines USING btree (dc_number);


--
-- Name: idx_delivery_challan_lines_delivery_person; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delivery_challan_lines_delivery_person ON public.delivery_challan_lines USING btree (delivery_person_id);


--
-- Name: idx_delivery_challan_lines_so; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delivery_challan_lines_so ON public.delivery_challan_lines USING btree (sales_order_number);


--
-- Name: idx_delivery_challan_lines_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delivery_challan_lines_status ON public.delivery_challan_lines USING btree (status);


--
-- Name: idx_delivery_technicians_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delivery_technicians_active ON public.delivery_technicians USING btree (is_active);


--
-- Name: idx_delivery_technicians_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_delivery_technicians_email ON public.delivery_technicians USING btree (lower((email)::text)) WHERE (email IS NOT NULL);


--
-- Name: idx_delivery_technicians_phone_country; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_delivery_technicians_phone_country ON public.delivery_technicians USING btree (country_code, phone) WHERE ((phone IS NOT NULL) AND ((phone)::text <> ''::text));


--
-- Name: idx_demo_agreements_decision; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demo_agreements_decision ON public.demo_agreements USING btree (decision, decision_due_at);


--
-- Name: idx_diagnosis_parts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_diagnosis_parts_status ON public.diagnosis_parts_required USING btree (status);


--
-- Name: idx_diagnosis_parts_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_diagnosis_parts_ticket ON public.diagnosis_parts_required USING btree (ticket_id);


--
-- Name: idx_diagnosis_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_diagnosis_ticket ON public.diagnosis_results USING btree (ticket_id);


--
-- Name: idx_einvoice_dc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_einvoice_dc ON public.einvoice_records USING btree (dc_number);


--
-- Name: idx_email_queue_status_schedule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_queue_status_schedule ON public.email_queue USING btree (status, scheduled_at);


--
-- Name: idx_existing_customer_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_existing_customer_email ON public.existing_customer USING btree (lower((email)::text));


--
-- Name: idx_existing_customer_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_existing_customer_name ON public.existing_customer USING btree (lower((customer_name)::text));


--
-- Name: idx_inv_status_trans_serial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_status_trans_serial ON public.inventory_status_transitions USING btree (serial_id);


--
-- Name: idx_inventory_machine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_machine ON public.inventory USING btree (machine_number);


--
-- Name: idx_inventory_serial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_serial ON public.inventory USING btree (serial_number);


--
-- Name: idx_inward_outward_serial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inward_outward_serial ON public.inward_outward USING btree (serial_number);


--
-- Name: idx_lead_addresses_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_addresses_lead_id ON public.lead_addresses USING btree (lead_id);


--
-- Name: idx_lead_followup_notifications_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_followup_notifications_lead ON public.lead_followup_notifications USING btree (lead_id);


--
-- Name: idx_lead_orders_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_orders_lead_id ON public.lead_orders USING btree (lead_id);


--
-- Name: idx_lead_remarks_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_remarks_lead ON public.lead_remarks USING btree (lead_id);


--
-- Name: idx_leads_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_assigned ON public.leads USING btree (assigned_user_id);


--
-- Name: idx_leads_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_email ON public.leads USING btree (email);


--
-- Name: idx_leads_follow_up; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_follow_up ON public.leads USING btree (follow_up_date);


--
-- Name: idx_leads_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_phone ON public.leads USING btree (phone);


--
-- Name: idx_leads_quotation_accept_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_quotation_accept_token ON public.leads USING btree (quotation_accept_token) WHERE (quotation_accept_token IS NOT NULL);


--
-- Name: idx_leads_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_status ON public.leads USING btree (status);


--
-- Name: idx_order_items_destination; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_destination ON public.order_items USING btree (order_id, destination_pincode);


--
-- Name: idx_order_items_qc_passed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_qc_passed ON public.order_items USING btree (order_id, qc_passed);


--
-- Name: idx_order_items_tracking_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_tracking_status ON public.order_items USING btree (order_id, tracking_status);


--
-- Name: idx_orders_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status_created ON public.orders USING btree (status, created_at DESC);


--
-- Name: idx_permission_audit_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permission_audit_logs_created ON public.permission_audit_logs USING btree (created_at DESC);


--
-- Name: idx_permission_audit_logs_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permission_audit_logs_target ON public.permission_audit_logs USING btree (target_type, target_id);


--
-- Name: idx_qc_results_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qc_results_result ON public.qc_results USING btree (qc_result);


--
-- Name: idx_qc_results_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qc_results_stage ON public.qc_results USING btree (qc_stage);


--
-- Name: idx_qc_results_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qc_results_ticket ON public.qc_results USING btree (ticket_id);


--
-- Name: idx_qc_rr_state_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qc_rr_state_updated ON public.qc_round_robin_state USING btree (updated_at);


--
-- Name: idx_rent_devices_serial_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rent_devices_serial_id ON public.rent_devices USING btree (serial_id);


--
-- Name: idx_repair_logs_serial_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_logs_serial_id ON public.repair_logs USING btree (serial_number_id);


--
-- Name: idx_sales_order_lines_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_order_lines_number ON public.sales_order_lines USING btree (sales_order_number);


--
-- Name: idx_sales_order_lines_quotation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_order_lines_quotation ON public.sales_order_lines USING btree (quotation_number);


--
-- Name: idx_sales_quotations_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_quotations_customer ON public.sales_quotations USING btree (customer_id);


--
-- Name: idx_sales_quotations_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_quotations_lead ON public.sales_quotations USING btree (source_lead_id) WHERE (source_lead_id IS NOT NULL);


--
-- Name: idx_sales_quotations_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_quotations_number ON public.sales_quotations USING btree (quotation_number);


--
-- Name: idx_sales_quotations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_quotations_status ON public.sales_quotations USING btree (status);


--
-- Name: idx_so_payments_so; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_payments_so ON public.sales_order_payments USING btree (sales_order_number);


--
-- Name: idx_sos_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sos_line ON public.sales_order_serials USING btree (line_id);


--
-- Name: idx_sos_so; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sos_so ON public.sales_order_serials USING btree (sales_order_number);


--
-- Name: idx_sos_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sos_ticket ON public.sales_order_serials USING btree (qc_ticket_id);


--
-- Name: idx_stages_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stages_category ON public.stages USING btree (stage_category);


--
-- Name: idx_support_item_comments_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_item_comments_item ON public.support_ticket_item_comments USING btree (item_id);


--
-- Name: idx_support_replacement_orders_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_replacement_orders_ticket ON public.support_replacement_orders USING btree (ticket_id);


--
-- Name: idx_support_ticket_items_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_ticket_items_assigned ON public.support_ticket_items USING btree (assigned_to);


--
-- Name: idx_support_ticket_items_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_ticket_items_ticket ON public.support_ticket_items USING btree (ticket_id);


--
-- Name: idx_support_tickets_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_customer ON public.support_tickets USING btree (customer_id);


--
-- Name: idx_support_tickets_delivery_person; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_delivery_person ON public.support_tickets USING btree (delivery_person_id);


--
-- Name: idx_support_tickets_return_dc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_return_dc ON public.support_tickets USING btree (return_dc_number);


--
-- Name: idx_support_tickets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_status ON public.support_tickets USING btree (status);


--
-- Name: idx_tickets_machine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_machine ON public.tickets USING btree (machine_number);


--
-- Name: idx_tickets_serial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_serial ON public.tickets USING btree (serial_number);


--
-- Name: idx_tickets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_status ON public.tickets USING btree (status);


--
-- Name: idx_tickets_ttspl_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_ttspl_id ON public.tickets USING btree (ttspl_id);


--
-- Name: idx_tickets_vendor_serial_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_vendor_serial_id ON public.tickets USING btree (vendor_serial_id) WHERE (vendor_serial_id IS NOT NULL);


--
-- Name: idx_ttspl_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ttspl_audit_created ON public.ttspl_audit_log USING btree (created_at DESC);


--
-- Name: idx_ttspl_audit_ttspl; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ttspl_audit_ttspl ON public.ttspl_audit_log USING btree (ttspl_id);


--
-- Name: idx_ttspl_config_history_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ttspl_config_history_ticket ON public.ttspl_config_history USING btree (ticket_id);


--
-- Name: idx_ttspl_config_history_ttspl; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ttspl_config_history_ttspl ON public.ttspl_config_history USING btree (ttspl_id);


--
-- Name: idx_user_teams_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_teams_team ON public.user_teams USING btree (team_id);


--
-- Name: idx_user_teams_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_teams_user ON public.user_teams USING btree (user_id);


--
-- Name: idx_vendor_audit_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_audit_actor ON public.vendor_audit_logs USING btree (actor_user_id);


--
-- Name: idx_vendor_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_audit_entity ON public.vendor_audit_logs USING btree (entity_type, entity_id);


--
-- Name: idx_vendor_billing_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_billing_period ON public.vendor_billing USING btree (billing_year, billing_month);


--
-- Name: idx_vendor_billing_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_billing_status ON public.vendor_billing USING btree (status);


--
-- Name: idx_vendor_billing_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_billing_vendor ON public.vendor_billing USING btree (vendor_id);


--
-- Name: idx_vendor_portal_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_portal_sessions_expires ON public.vendor_portal_sessions USING btree (expires_at);


--
-- Name: idx_vendor_portal_sessions_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_portal_sessions_vendor ON public.vendor_portal_sessions USING btree (vendor_id);


--
-- Name: idx_vendor_product_details_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_product_details_po ON public.vendor_product_details USING btree (po_id);


--
-- Name: idx_vendor_product_inventory_serial_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_vendor_product_inventory_serial_id ON public.vendor_product_inventory USING btree (serial_id);


--
-- Name: idx_vendor_product_inventory_serial_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_vendor_product_inventory_serial_number ON public.vendor_product_inventory USING btree (lower((serial_number)::text));


--
-- Name: idx_vendor_refresh_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_refresh_vendor ON public.vendor_refresh_tokens USING btree (vendor_id);


--
-- Name: idx_vendor_replaced_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_replaced_status ON public.vendor_replaced_products USING btree (status);


--
-- Name: idx_vendor_replaced_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_replaced_vendor ON public.vendor_replaced_products USING btree (vendor_id);


--
-- Name: idx_vendor_serial_inventory_asset_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_vendor_serial_inventory_asset_code_unique ON public.vendor_serial_numbers USING btree (inventory_asset_code) WHERE ((inventory_asset_code IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: idx_vendor_serial_inventory_status_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_serial_inventory_status_po ON public.vendor_serial_numbers USING btree (inventory_status, po_id) WHERE ((deleted_at IS NULL) AND (po_id IS NOT NULL));


--
-- Name: idx_vendor_serial_po_grn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_serial_po_grn ON public.vendor_serial_numbers USING btree (po_id, grn_id);


--
-- Name: idx_vendor_serial_spo_grn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_serial_spo_grn ON public.vendor_serial_numbers USING btree (spo_id, grn_id) WHERE (spo_id IS NOT NULL);


--
-- Name: idx_vendor_serial_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_vendor_serial_unique ON public.vendor_serial_numbers USING btree (lower((serial_number)::text)) WHERE (deleted_at IS NULL);


--
-- Name: idx_vendor_shops_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_vendor_shops_one_active ON public.vendor_shops USING btree (vendor_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_vendor_shops_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_shops_vendor ON public.vendor_shops USING btree (vendor_id);


--
-- Name: idx_vendors_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_deleted ON public.vendors USING btree (deleted_at);


--
-- Name: idx_vendors_email_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_vendors_email_active ON public.vendors USING btree (lower((email)::text)) WHERE (deleted_at IS NULL);


--
-- Name: idx_vendors_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_status ON public.vendors USING btree (status);


--
-- Name: idx_vgrn_bill_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vgrn_bill_status ON public.vendor_goods_received_notes USING btree (bill_status) WHERE (deleted_at IS NULL);


--
-- Name: idx_vgrn_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vgrn_po ON public.vendor_goods_received_notes USING btree (po_id);


--
-- Name: idx_vgrn_spo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vgrn_spo ON public.vendor_goods_received_notes USING btree (spo_id) WHERE (spo_id IS NOT NULL);


--
-- Name: idx_vpo_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vpo_dates ON public.vendor_purchase_orders USING btree (purchase_order_date DESC);


--
-- Name: idx_vpo_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vpo_deleted ON public.vendor_purchase_orders USING btree (deleted_at);


--
-- Name: idx_vpo_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vpo_status ON public.vendor_purchase_orders USING btree (status);


--
-- Name: idx_vpo_status_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vpo_status_workflow ON public.vendor_purchase_orders USING btree (status) WHERE (deleted_at IS NULL);


--
-- Name: idx_vpo_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vpo_vendor ON public.vendor_purchase_orders USING btree (vendor_id);


--
-- Name: idx_vsn_current_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vsn_current_customer ON public.vendor_serial_numbers USING btree (current_customer_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_vsn_status_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vsn_status_entity ON public.vendor_serial_numbers USING btree (inventory_status, current_entity) WHERE (deleted_at IS NULL);


--
-- Name: idx_vspc_active_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vspc_active_name ON public.vendor_spare_parts_catalog USING btree (active, name);


--
-- Name: idx_vspo_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vspo_status ON public.vendor_spare_parts_purchase_orders USING btree (status);


--
-- Name: idx_vspo_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vspo_vendor ON public.vendor_spare_parts_purchase_orders USING btree (vendor_id);


--
-- Name: idx_work_logs_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_logs_active ON public.work_logs USING btree (ticket_id) WHERE (end_time IS NULL);


--
-- Name: idx_work_logs_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_logs_ticket ON public.work_logs USING btree (ticket_id);


--
-- Name: uq_customer_inventory_line; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_customer_inventory_line ON public.customer_inventory USING btree (customer_id, asset_kind, asset_bucket, COALESCE((delivery_challan_id)::text, ''::text), COALESCE(erp_serial_id, ''::character varying), COALESCE(unique_serial_number, ''::character varying), COALESCE(serial_number, ''::character varying));


--
-- Name: uq_sos_serial_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_sos_serial_active ON public.sales_order_serials USING btree (serial_id) WHERE ((status)::text = 'attached'::text);


--
-- Name: uq_tickets_serial_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_tickets_serial_open ON public.tickets USING btree (serial_number) WHERE ((status)::text = ANY ((ARRAY['in_progress'::character varying, 'on_hold'::character varying])::text[]));


--
-- Name: lead_activities trg_lead_last_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lead_last_activity AFTER INSERT ON public.lead_activities FOR EACH ROW EXECUTE FUNCTION public.update_lead_last_activity();


--
-- Name: inventory update_inventory_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_inventory_updated_at BEFORE UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: leads update_leads_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: tickets update_tickets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_tickets_updated_at BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: activities activities_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.stages(stage_id);


--
-- Name: activities activities_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: activities activities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: chip_level_repairs chip_level_repairs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chip_level_repairs
    ADD CONSTRAINT chip_level_repairs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: chip_level_repairs chip_level_repairs_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chip_level_repairs
    ADD CONSTRAINT chip_level_repairs_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: chip_level_repairs chip_level_repairs_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chip_level_repairs
    ADD CONSTRAINT chip_level_repairs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id);


--
-- Name: customer_addresses customer_addresses_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_addresses
    ADD CONSTRAINT customer_addresses_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE CASCADE;


--
-- Name: customer_credit_notes customer_credit_notes_applied_in_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_credit_notes
    ADD CONSTRAINT customer_credit_notes_applied_in_invoice_id_fkey FOREIGN KEY (applied_in_invoice_id) REFERENCES public.customer_invoices(invoice_id);


--
-- Name: customer_credit_notes customer_credit_notes_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_credit_notes
    ADD CONSTRAINT customer_credit_notes_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(user_id);


--
-- Name: customer_credit_notes customer_credit_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_credit_notes
    ADD CONSTRAINT customer_credit_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: customer_credit_notes customer_credit_notes_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_credit_notes
    ADD CONSTRAINT customer_credit_notes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id);


--
-- Name: customer_credit_notes customer_credit_notes_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_credit_notes
    ADD CONSTRAINT customer_credit_notes_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.customer_invoices(invoice_id);


--
-- Name: customer_documents customer_documents_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_documents
    ADD CONSTRAINT customer_documents_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE CASCADE;


--
-- Name: customer_documents customer_documents_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_documents
    ADD CONSTRAINT customer_documents_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE SET NULL;


--
-- Name: customer_documents customer_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_documents
    ADD CONSTRAINT customer_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(user_id);


--
-- Name: customer_inventory customer_inventory_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_inventory
    ADD CONSTRAINT customer_inventory_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.existing_customer(customer_id) ON DELETE CASCADE;


--
-- Name: customer_invoices customer_invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invoices
    ADD CONSTRAINT customer_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id);


--
-- Name: customer_invoices customer_invoices_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invoices
    ADD CONSTRAINT customer_invoices_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES public.users(user_id);


--
-- Name: customer_portal_sessions customer_portal_sessions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_portal_sessions
    ADD CONSTRAINT customer_portal_sessions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE CASCADE;


--
-- Name: customer_security_deposits customer_security_deposits_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_security_deposits
    ADD CONSTRAINT customer_security_deposits_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: customer_security_deposits customer_security_deposits_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_security_deposits
    ADD CONSTRAINT customer_security_deposits_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id);


--
-- Name: customers customers_kyc_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_kyc_verified_by_fkey FOREIGN KEY (kyc_verified_by) REFERENCES public.users(user_id);


--
-- Name: customers customers_onboarded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_onboarded_by_fkey FOREIGN KEY (onboarded_by) REFERENCES public.users(user_id);


--
-- Name: customers customers_source_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_source_lead_id_fkey FOREIGN KEY (source_lead_id) REFERENCES public.leads(lead_id) ON DELETE SET NULL;


--
-- Name: dc_qc_tickets dc_qc_tickets_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_qc_tickets
    ADD CONSTRAINT dc_qc_tickets_serial_id_fkey FOREIGN KEY (serial_id) REFERENCES public.vendor_serial_numbers(serial_id);


--
-- Name: dc_qc_tickets dc_qc_tickets_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_qc_tickets
    ADD CONSTRAINT dc_qc_tickets_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: delivery_challan_lines delivery_challan_lines_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_challan_lines
    ADD CONSTRAINT delivery_challan_lines_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: delivery_challan_lines delivery_challan_lines_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_challan_lines
    ADD CONSTRAINT delivery_challan_lines_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE SET NULL;


--
-- Name: delivery_challan_lines delivery_challan_lines_delivered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_challan_lines
    ADD CONSTRAINT delivery_challan_lines_delivered_by_fkey FOREIGN KEY (delivered_by) REFERENCES public.users(user_id);


--
-- Name: delivery_challan_lines delivery_challan_lines_invoice_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_challan_lines
    ADD CONSTRAINT delivery_challan_lines_invoice_sent_by_fkey FOREIGN KEY (invoice_sent_by) REFERENCES public.users(user_id);


--
-- Name: delivery_challan_lines delivery_challan_lines_pre_dispatch_qc_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_challan_lines
    ADD CONSTRAINT delivery_challan_lines_pre_dispatch_qc_ticket_id_fkey FOREIGN KEY (pre_dispatch_qc_ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: delivery_technicians delivery_technicians_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_technicians
    ADD CONSTRAINT delivery_technicians_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: demo_agreements demo_agreements_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_agreements
    ADD CONSTRAINT demo_agreements_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id);


--
-- Name: demo_agreements demo_agreements_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_agreements
    ADD CONSTRAINT demo_agreements_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(user_id);


--
-- Name: demo_agreements demo_agreements_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_agreements
    ADD CONSTRAINT demo_agreements_serial_id_fkey FOREIGN KEY (serial_id) REFERENCES public.vendor_serial_numbers(serial_id);


--
-- Name: diagnosis_images diagnosis_images_diagnosis_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnosis_images
    ADD CONSTRAINT diagnosis_images_diagnosis_id_fkey FOREIGN KEY (diagnosis_id) REFERENCES public.diagnosis_results(diagnosis_id) ON DELETE CASCADE;


--
-- Name: diagnosis_parts_required diagnosis_parts_required_attached_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnosis_parts_required
    ADD CONSTRAINT diagnosis_parts_required_attached_by_fkey FOREIGN KEY (attached_by) REFERENCES public.users(user_id);


--
-- Name: diagnosis_parts_required diagnosis_parts_required_diagnosis_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnosis_parts_required
    ADD CONSTRAINT diagnosis_parts_required_diagnosis_id_fkey FOREIGN KEY (diagnosis_id) REFERENCES public.diagnosis_results(diagnosis_id) ON DELETE CASCADE;


--
-- Name: diagnosis_parts_required diagnosis_parts_required_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnosis_parts_required
    ADD CONSTRAINT diagnosis_parts_required_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: diagnosis_results diagnosis_results_diagnosed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnosis_results
    ADD CONSTRAINT diagnosis_results_diagnosed_by_fkey FOREIGN KEY (diagnosed_by) REFERENCES public.users(user_id);


--
-- Name: diagnosis_results diagnosis_results_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnosis_results
    ADD CONSTRAINT diagnosis_results_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: einvoice_records einvoice_records_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einvoice_records
    ADD CONSTRAINT einvoice_records_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id);


--
-- Name: einvoice_records einvoice_records_generated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einvoice_records
    ADD CONSTRAINT einvoice_records_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES public.users(user_id);


--
-- Name: einvoice_records einvoice_records_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einvoice_records
    ADD CONSTRAINT einvoice_records_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.customer_invoices(invoice_id);


--
-- Name: eway_bill_records eway_bill_records_generated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eway_bill_records
    ADD CONSTRAINT eway_bill_records_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES public.users(user_id);


--
-- Name: inventory_status_transitions inventory_status_transitions_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_status_transitions
    ADD CONSTRAINT inventory_status_transitions_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(user_id);


--
-- Name: inventory_status_transitions inventory_status_transitions_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_status_transitions
    ADD CONSTRAINT inventory_status_transitions_serial_id_fkey FOREIGN KEY (serial_id) REFERENCES public.vendor_serial_numbers(serial_id) ON DELETE CASCADE;


--
-- Name: lead_activities lead_activities_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE CASCADE;


--
-- Name: lead_activities lead_activities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: lead_addresses lead_addresses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_addresses
    ADD CONSTRAINT lead_addresses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: lead_addresses lead_addresses_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_addresses
    ADD CONSTRAINT lead_addresses_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE CASCADE;


--
-- Name: lead_assignments lead_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_assignments
    ADD CONSTRAINT lead_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(user_id);


--
-- Name: lead_assignments lead_assignments_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_assignments
    ADD CONSTRAINT lead_assignments_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(user_id);


--
-- Name: lead_assignments lead_assignments_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_assignments
    ADD CONSTRAINT lead_assignments_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE CASCADE;


--
-- Name: lead_auto_assign_config lead_auto_assign_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_auto_assign_config
    ADD CONSTRAINT lead_auto_assign_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id);


--
-- Name: lead_company_research lead_company_research_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_company_research
    ADD CONSTRAINT lead_company_research_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE CASCADE;


--
-- Name: lead_followup_notifications lead_followup_notifications_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_followup_notifications
    ADD CONSTRAINT lead_followup_notifications_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE CASCADE;


--
-- Name: lead_import_logs lead_import_logs_imported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_import_logs
    ADD CONSTRAINT lead_import_logs_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES public.users(user_id);


--
-- Name: lead_orders lead_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_orders
    ADD CONSTRAINT lead_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: lead_orders lead_orders_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_orders
    ADD CONSTRAINT lead_orders_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE CASCADE;


--
-- Name: lead_remarks lead_remarks_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_remarks
    ADD CONSTRAINT lead_remarks_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE CASCADE;


--
-- Name: lead_remarks lead_remarks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_remarks
    ADD CONSTRAINT lead_remarks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: leads leads_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(user_id);


--
-- Name: leads leads_assigned_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES public.users(user_id);


--
-- Name: leads leads_converted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_converted_by_fkey FOREIGN KEY (converted_by) REFERENCES public.users(user_id);


--
-- Name: leads leads_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id);


--
-- Name: leads leads_duplicate_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_duplicate_of_fkey FOREIGN KEY (duplicate_of) REFERENCES public.leads(lead_id);


--
-- Name: order_items order_items_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES public.inventory(inventory_id);


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(order_id) ON DELETE CASCADE;


--
-- Name: orders orders_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(user_id);


--
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE CASCADE;


--
-- Name: orders orders_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(user_id);


--
-- Name: part_requests part_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_requests
    ADD CONSTRAINT part_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(user_id);


--
-- Name: part_requests part_requests_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_requests
    ADD CONSTRAINT part_requests_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: permission_audit_logs permission_audit_logs_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_audit_logs
    ADD CONSTRAINT permission_audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: photos photos_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.stages(stage_id);


--
-- Name: photos photos_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: photos photos_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(user_id);


--
-- Name: procurement_requests procurement_requests_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_requests
    ADD CONSTRAINT procurement_requests_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(item_id) ON DELETE CASCADE;


--
-- Name: qc_photos qc_photos_qc_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_photos
    ADD CONSTRAINT qc_photos_qc_id_fkey FOREIGN KEY (qc_id) REFERENCES public.qc_results(qc_id) ON DELETE CASCADE;


--
-- Name: qc_results qc_results_checked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_results
    ADD CONSTRAINT qc_results_checked_by_fkey FOREIGN KEY (checked_by) REFERENCES public.users(user_id);


--
-- Name: qc_results qc_results_tested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_results
    ADD CONSTRAINT qc_results_tested_by_fkey FOREIGN KEY (tested_by) REFERENCES public.users(user_id);


--
-- Name: qc_results qc_results_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_results
    ADD CONSTRAINT qc_results_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: sales_order_lines sales_order_lines_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_lines
    ADD CONSTRAINT sales_order_lines_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: sales_order_lines sales_order_lines_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_lines
    ADD CONSTRAINT sales_order_lines_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE SET NULL;


--
-- Name: sales_order_payments sales_order_payments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_payments
    ADD CONSTRAINT sales_order_payments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id);


--
-- Name: sales_order_payments sales_order_payments_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_payments
    ADD CONSTRAINT sales_order_payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(user_id);


--
-- Name: sales_order_serials sales_order_serials_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_serials
    ADD CONSTRAINT sales_order_serials_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: sales_order_serials sales_order_serials_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_serials
    ADD CONSTRAINT sales_order_serials_serial_id_fkey FOREIGN KEY (serial_id) REFERENCES public.vendor_serial_numbers(serial_id);


--
-- Name: sales_quotations sales_quotations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotations
    ADD CONSTRAINT sales_quotations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: sales_quotations sales_quotations_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotations
    ADD CONSTRAINT sales_quotations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE SET NULL;


--
-- Name: sales_quotations sales_quotations_source_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotations
    ADD CONSTRAINT sales_quotations_source_lead_id_fkey FOREIGN KEY (source_lead_id) REFERENCES public.leads(lead_id);


--
-- Name: stage_checklists stage_checklists_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_checklists
    ADD CONSTRAINT stage_checklists_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.stages(stage_id);


--
-- Name: stages stages_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stages
    ADD CONSTRAINT stages_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id);


--
-- Name: support_replacement_orders support_replacement_orders_complaint_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_replacement_orders
    ADD CONSTRAINT support_replacement_orders_complaint_item_id_fkey FOREIGN KEY (complaint_item_id) REFERENCES public.support_ticket_items(id);


--
-- Name: support_replacement_orders support_replacement_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_replacement_orders
    ADD CONSTRAINT support_replacement_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: support_replacement_orders support_replacement_orders_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_replacement_orders
    ADD CONSTRAINT support_replacement_orders_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.support_ticket_items(id) ON DELETE CASCADE;


--
-- Name: support_replacement_orders support_replacement_orders_pickup_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_replacement_orders
    ADD CONSTRAINT support_replacement_orders_pickup_item_id_fkey FOREIGN KEY (pickup_item_id) REFERENCES public.support_ticket_items(id);


--
-- Name: support_replacement_orders support_replacement_orders_source_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_replacement_orders
    ADD CONSTRAINT support_replacement_orders_source_item_id_fkey FOREIGN KEY (source_item_id) REFERENCES public.support_ticket_items(id);


--
-- Name: support_replacement_orders support_replacement_orders_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_replacement_orders
    ADD CONSTRAINT support_replacement_orders_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- Name: support_ticket_item_audit support_ticket_item_audit_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_item_audit
    ADD CONSTRAINT support_ticket_item_audit_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.support_ticket_items(id) ON DELETE CASCADE;


--
-- Name: support_ticket_item_audit support_ticket_item_audit_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_item_audit
    ADD CONSTRAINT support_ticket_item_audit_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- Name: support_ticket_item_audit support_ticket_item_audit_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_item_audit
    ADD CONSTRAINT support_ticket_item_audit_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: support_ticket_item_comments support_ticket_item_comments_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_item_comments
    ADD CONSTRAINT support_ticket_item_comments_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.support_ticket_items(id) ON DELETE CASCADE;


--
-- Name: support_ticket_item_comments support_ticket_item_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_item_comments
    ADD CONSTRAINT support_ticket_item_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: support_ticket_items support_ticket_items_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(user_id);


--
-- Name: support_ticket_items support_ticket_items_issue_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_issue_category_id_fkey FOREIGN KEY (issue_category_id) REFERENCES public.support_issue_categories(id);


--
-- Name: support_ticket_items support_ticket_items_outcome_set_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_outcome_set_by_fkey FOREIGN KEY (outcome_set_by) REFERENCES public.users(user_id);


--
-- Name: support_ticket_items support_ticket_items_pickup_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_pickup_assigned_to_fkey FOREIGN KEY (pickup_assigned_to) REFERENCES public.users(user_id);


--
-- Name: support_ticket_items support_ticket_items_replacement_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_replacement_approved_by_fkey FOREIGN KEY (replacement_approved_by) REFERENCES public.users(user_id);


--
-- Name: support_ticket_items support_ticket_items_replacement_flagged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_replacement_flagged_by_fkey FOREIGN KEY (replacement_flagged_by) REFERENCES public.users(user_id);


--
-- Name: support_ticket_items support_ticket_items_source_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_source_item_id_fkey FOREIGN KEY (source_item_id) REFERENCES public.support_ticket_items(id);


--
-- Name: support_ticket_items support_ticket_items_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- Name: support_tickets support_tickets_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.users(user_id);


--
-- Name: support_tickets support_tickets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: support_tickets support_tickets_portal_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_portal_customer_id_fkey FOREIGN KEY (portal_customer_id) REFERENCES public.customers(customer_id);


--
-- Name: ticket_checklist_progress ticket_checklist_progress_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_checklist_progress
    ADD CONSTRAINT ticket_checklist_progress_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.users(user_id);


--
-- Name: ticket_checklist_progress ticket_checklist_progress_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_checklist_progress
    ADD CONSTRAINT ticket_checklist_progress_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.stages(stage_id);


--
-- Name: ticket_checklist_progress ticket_checklist_progress_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_checklist_progress
    ADD CONSTRAINT ticket_checklist_progress_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: ticket_parts ticket_parts_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_parts
    ADD CONSTRAINT ticket_parts_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(part_id);


--
-- Name: ticket_parts ticket_parts_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_parts
    ADD CONSTRAINT ticket_parts_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: ticket_services ticket_services_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_services
    ADD CONSTRAINT ticket_services_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(user_id);


--
-- Name: ticket_services ticket_services_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_services
    ADD CONSTRAINT ticket_services_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: tickets tickets_assigned_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_assigned_team_id_fkey FOREIGN KEY (assigned_team_id) REFERENCES public.teams(team_id);


--
-- Name: tickets tickets_assigned_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES public.users(user_id);


--
-- Name: tickets tickets_current_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_current_stage_id_fkey FOREIGN KEY (current_stage_id) REFERENCES public.stages(stage_id);


--
-- Name: tickets tickets_vendor_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_vendor_serial_id_fkey FOREIGN KEY (vendor_serial_id) REFERENCES public.vendor_serial_numbers(serial_id) ON DELETE SET NULL;


--
-- Name: ttspl_audit_log ttspl_audit_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ttspl_audit_log
    ADD CONSTRAINT ttspl_audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(user_id);


--
-- Name: ttspl_audit_log ttspl_audit_log_vendor_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ttspl_audit_log
    ADD CONSTRAINT ttspl_audit_log_vendor_serial_id_fkey FOREIGN KEY (vendor_serial_id) REFERENCES public.vendor_serial_numbers(serial_id);


--
-- Name: ttspl_config_history ttspl_config_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ttspl_config_history
    ADD CONSTRAINT ttspl_config_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(user_id);


--
-- Name: ttspl_config_history ttspl_config_history_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ttspl_config_history
    ADD CONSTRAINT ttspl_config_history_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: ttspl_config_history ttspl_config_history_vendor_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ttspl_config_history
    ADD CONSTRAINT ttspl_config_history_vendor_serial_id_fkey FOREIGN KEY (vendor_serial_id) REFERENCES public.vendor_serial_numbers(serial_id);


--
-- Name: user_permissions user_permissions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(user_id);


--
-- Name: user_permissions user_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: user_teams user_teams_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_teams
    ADD CONSTRAINT user_teams_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id) ON DELETE CASCADE;


--
-- Name: user_teams user_teams_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_teams
    ADD CONSTRAINT user_teams_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: users users_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(user_id);


--
-- Name: users users_deactivated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_deactivated_by_fkey FOREIGN KEY (deactivated_by) REFERENCES public.users(user_id);


--
-- Name: users users_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id);


--
-- Name: vendor_audit_logs vendor_audit_logs_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_audit_logs
    ADD CONSTRAINT vendor_audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: vendor_audit_logs vendor_audit_logs_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_audit_logs
    ADD CONSTRAINT vendor_audit_logs_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id) ON DELETE SET NULL;


--
-- Name: vendor_billing vendor_billing_assigned_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_billing
    ADD CONSTRAINT vendor_billing_assigned_to_user_id_fkey FOREIGN KEY (assigned_to_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: vendor_billing vendor_billing_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_billing
    ADD CONSTRAINT vendor_billing_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id) ON DELETE SET NULL;


--
-- Name: vendor_debit_notes vendor_debit_notes_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_debit_notes
    ADD CONSTRAINT vendor_debit_notes_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(user_id);


--
-- Name: vendor_debit_notes vendor_debit_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_debit_notes
    ADD CONSTRAINT vendor_debit_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: vendor_debit_notes vendor_debit_notes_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_debit_notes
    ADD CONSTRAINT vendor_debit_notes_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.vendor_purchase_orders(po_id);


--
-- Name: vendor_debit_notes vendor_debit_notes_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_debit_notes
    ADD CONSTRAINT vendor_debit_notes_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id);


--
-- Name: vendor_goods_received_notes vendor_goods_received_notes_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_goods_received_notes
    ADD CONSTRAINT vendor_goods_received_notes_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.vendor_purchase_orders(po_id) ON DELETE CASCADE;


--
-- Name: vendor_goods_received_notes vendor_goods_received_notes_spo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_goods_received_notes
    ADD CONSTRAINT vendor_goods_received_notes_spo_id_fkey FOREIGN KEY (spo_id) REFERENCES public.vendor_spare_parts_purchase_orders(spo_id) ON DELETE CASCADE;


--
-- Name: vendor_monthly_bills vendor_monthly_bills_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_monthly_bills
    ADD CONSTRAINT vendor_monthly_bills_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(user_id);


--
-- Name: vendor_monthly_bills vendor_monthly_bills_generated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_monthly_bills
    ADD CONSTRAINT vendor_monthly_bills_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES public.users(user_id);


--
-- Name: vendor_monthly_bills vendor_monthly_bills_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_monthly_bills
    ADD CONSTRAINT vendor_monthly_bills_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id);


--
-- Name: vendor_portal_sessions vendor_portal_sessions_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_portal_sessions
    ADD CONSTRAINT vendor_portal_sessions_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id) ON DELETE CASCADE;


--
-- Name: vendor_product_details vendor_product_details_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_product_details
    ADD CONSTRAINT vendor_product_details_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.vendor_purchase_orders(po_id) ON DELETE CASCADE;


--
-- Name: vendor_product_inventory vendor_product_inventory_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_product_inventory
    ADD CONSTRAINT vendor_product_inventory_serial_id_fkey FOREIGN KEY (serial_id) REFERENCES public.vendor_serial_numbers(serial_id) ON DELETE CASCADE;


--
-- Name: vendor_purchase_orders vendor_purchase_orders_status_updated_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_purchase_orders
    ADD CONSTRAINT vendor_purchase_orders_status_updated_by_admin_id_fkey FOREIGN KEY (status_updated_by_admin_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: vendor_purchase_orders vendor_purchase_orders_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_purchase_orders
    ADD CONSTRAINT vendor_purchase_orders_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id);


--
-- Name: vendor_refresh_tokens vendor_refresh_tokens_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_refresh_tokens
    ADD CONSTRAINT vendor_refresh_tokens_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id) ON DELETE CASCADE;


--
-- Name: vendor_replaced_products vendor_replaced_products_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_replaced_products
    ADD CONSTRAINT vendor_replaced_products_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.vendor_purchase_orders(po_id) ON DELETE SET NULL;


--
-- Name: vendor_replaced_products vendor_replaced_products_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_replaced_products
    ADD CONSTRAINT vendor_replaced_products_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id) ON DELETE SET NULL;


--
-- Name: vendor_serial_number_audit vendor_serial_number_audit_changed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_serial_number_audit
    ADD CONSTRAINT vendor_serial_number_audit_changed_by_user_id_fkey FOREIGN KEY (changed_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: vendor_serial_numbers vendor_serial_numbers_current_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_serial_numbers
    ADD CONSTRAINT vendor_serial_numbers_current_customer_id_fkey FOREIGN KEY (current_customer_id) REFERENCES public.customers(customer_id);


--
-- Name: vendor_serial_numbers vendor_serial_numbers_grn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_serial_numbers
    ADD CONSTRAINT vendor_serial_numbers_grn_id_fkey FOREIGN KEY (grn_id) REFERENCES public.vendor_goods_received_notes(grn_id) ON DELETE CASCADE;


--
-- Name: vendor_serial_numbers vendor_serial_numbers_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_serial_numbers
    ADD CONSTRAINT vendor_serial_numbers_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.vendor_purchase_orders(po_id) ON DELETE CASCADE;


--
-- Name: vendor_serial_numbers vendor_serial_numbers_spo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_serial_numbers
    ADD CONSTRAINT vendor_serial_numbers_spo_id_fkey FOREIGN KEY (spo_id) REFERENCES public.vendor_spare_parts_purchase_orders(spo_id) ON DELETE CASCADE;


--
-- Name: vendor_shops vendor_shops_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_shops
    ADD CONSTRAINT vendor_shops_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id) ON DELETE CASCADE;


--
-- Name: vendor_spare_parts_purchase_orders vendor_spare_parts_purchase_ord_status_updated_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_spare_parts_purchase_orders
    ADD CONSTRAINT vendor_spare_parts_purchase_ord_status_updated_by_admin_id_fkey FOREIGN KEY (status_updated_by_admin_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: vendor_spare_parts_purchase_orders vendor_spare_parts_purchase_orders_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_spare_parts_purchase_orders
    ADD CONSTRAINT vendor_spare_parts_purchase_orders_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id);


--
-- Name: vendor_wallets vendor_wallets_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_wallets
    ADD CONSTRAINT vendor_wallets_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id) ON DELETE CASCADE;


--
-- Name: work_logs work_logs_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT work_logs_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.stages(stage_id);


--
-- Name: work_logs work_logs_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT work_logs_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: work_logs work_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT work_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- PostgreSQL database dump complete
--

\unrestrict YaGzY79DfnMJjP83fTxtuhO0RBe3evHF9WeQPzd57Vo7xPiJdfTWiy4gcn9rBIn

